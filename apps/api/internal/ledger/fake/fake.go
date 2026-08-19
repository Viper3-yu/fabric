// Package fake provides a file-backed Ledger test double. It implements the
// same state machine as the chaincode so HTTP-layer tests stay hermetic, but
// it is never linked into the server binary: only tests import it.
package fake

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/Viper3-yu/fabric/apps/api/internal/apperror"
	"github.com/Viper3-yu/fabric/apps/api/internal/ledger"
	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
)

var _ ledger.Ledger = (*Fake)(nil)

type state struct {
	Version   int                                     `json:"version"`
	Shipments map[string]model.Shipment               `json:"shipments"`
	Histories map[string][]model.ShipmentHistoryEntry `json:"histories"`
}

type eventDraft struct {
	Type         string
	Location     string
	Description  string
	Temperature  *float64
	EvidenceHash string
}

type Fake struct {
	path  string
	mu    sync.RWMutex
	state state
}

func New(path string) (*Fake, error) {
	f := &Fake{path: path, state: emptyState()}
	if err := f.load(); err != nil {
		return nil, err
	}
	return f, nil
}

func emptyState() state {
	return state{
		Version:   1,
		Shipments: make(map[string]model.Shipment),
		Histories: make(map[string][]model.ShipmentHistoryEntry),
	}
}

// Mode reports "fabric" so the API surfaces behave exactly as they do against
// the real ledger; the double exists only inside test processes.
func (f *Fake) Mode() string {
	return "fabric"
}

// Close releases nothing; it exists so the double shares the Ledger lifecycle.
func (f *Fake) Close() error {
	return nil
}

func (f *Fake) load() error {
	if err := os.MkdirAll(filepath.Dir(f.path), 0o755); err != nil {
		return err
	}
	content, err := os.ReadFile(f.path)
	if errors.Is(err, os.ErrNotExist) {
		return f.persistLocked()
	}
	if err != nil {
		return apperror.WithDetails(500, "FAKE_LEDGER_CORRUPT", "The fake ledger file cannot be read", map[string]string{"path": f.path})
	}
	var stored state
	if err := json.Unmarshal(content, &stored); err != nil ||
		stored.Version != 1 || stored.Shipments == nil || stored.Histories == nil {
		return apperror.WithDetails(500, "FAKE_LEDGER_CORRUPT", "The fake ledger file cannot be read", map[string]string{"path": f.path})
	}
	f.state = stored
	return nil
}

func (f *Fake) persistLocked() error {
	content, err := json.MarshalIndent(f.state, "", "  ")
	if err != nil {
		return err
	}
	content = append(content, '\n')
	// A unique temp file avoids two processes clobbering the same name, and
	// Sync-before-rename keeps the target file whole on crash.
	temporary, err := os.CreateTemp(filepath.Dir(f.path), filepath.Base(f.path)+".*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Chmod(temporaryName, 0o600); err != nil {
		return err
	}
	return os.Rename(temporaryName, f.path)
}

func (f *Fake) Health(context.Context) ledger.Health {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return ledger.Health{Mode: "fabric", Status: "ok", Network: "fake-test-double"}
}

func (f *Fake) GetAllShipments(context.Context, *model.User) ([]model.Shipment, error) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	result := make([]model.Shipment, 0, len(f.state.Shipments))
	for _, shipment := range f.state.Shipments {
		result = append(result, cloneShipment(shipment))
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt > result[j].UpdatedAt
	})
	return result, nil
}

func (f *Fake) ReadShipment(_ context.Context, id string, _ *model.User) (model.Shipment, error) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	shipment, ok := f.state.Shipments[id]
	if !ok {
		return model.Shipment{}, apperror.New(404, "SHIPMENT_NOT_FOUND", "Shipment was not found")
	}
	return cloneShipment(shipment), nil
}

func (f *Fake) ReadShipmentByTracking(
	_ context.Context,
	trackingNumber string,
	_ *model.User,
) (model.Shipment, error) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	for _, shipment := range f.state.Shipments {
		if shipment.TrackingNumber == trackingNumber {
			return cloneShipment(shipment), nil
		}
	}
	return model.Shipment{}, apperror.New(
		404, "TRACKING_NOT_FOUND", "No shipment matches this tracking number",
	)
}

func (f *Fake) GetShipmentHistory(_ context.Context, id string, _ *model.User) ([]model.ShipmentHistoryEntry, error) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	if _, ok := f.state.Shipments[id]; !ok {
		return nil, apperror.New(404, "SHIPMENT_NOT_FOUND", "Shipment was not found")
	}
	return cloneHistory(f.state.Histories[id]), nil
}

func (f *Fake) CreateShipment(
	_ context.Context,
	command ledger.CreateShipmentCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.mutate(func() (model.LedgerReceipt, error) {
		if err := requireRole(actor, "shipper"); err != nil {
			return model.LedgerReceipt{}, err
		}
		if _, exists := f.state.Shipments[command.ID]; exists {
			return model.LedgerReceipt{}, apperror.New(409, "SHIPMENT_EXISTS", "Shipment ID already exists")
		}
		for _, shipment := range f.state.Shipments {
			if shipment.TrackingNumber == command.TrackingNumber {
				return model.LedgerReceipt{}, apperror.New(409, "TRACKING_NUMBER_EXISTS", "Tracking number already exists")
			}
		}

		timestamp := nowISO()
		txID, err := fakeTxID()
		if err != nil {
			return model.LedgerReceipt{}, err
		}
		shipment := model.Shipment{
			DocType:              "shipment",
			ID:                   command.ID,
			TrackingNumber:       command.TrackingNumber,
			Status:               model.StatusCreated,
			ShipperID:            actor.ID,
			ShipperName:          actor.DisplayName,
			RecipientID:          command.RecipientID,
			Origin:               command.Origin,
			Destination:          command.Destination,
			Goods:                command.Goods,
			RecipientMasked:      command.RecipientMasked,
			ExpectedDeliveryDate: command.ExpectedDeliveryDate,
			TemperatureRange:     command.TemperatureRange,
			DeliveryCodeHash:     command.DeliveryCodeHash,
			DocumentHash:         command.DocumentHash,
			Events:               make([]model.ShipmentEvent, 0, 1),
			LastLocation:         command.Origin.City + " · " + command.Origin.Detail,
			CreatedAt:            timestamp,
			UpdatedAt:            timestamp,
		}
		appendEvent(&shipment, actor, txID, timestamp, eventDraft{
			Type: model.EventCreated, Location: shipment.LastLocation,
			Description: "发货方创建运单", EvidenceHash: command.DocumentHash,
		})
		f.state.Shipments[shipment.ID] = shipment
		f.addHistoryLocked(shipment, txID, timestamp)
		return receipt(shipment, txID, timestamp), nil
	})
}

func (f *Fake) AcceptShipment(
	_ context.Context,
	id string,
	command ledger.ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.transition(id, actor, []string{"carrier"}, []string{model.StatusCreated},
		func(shipment *model.Shipment, txID, timestamp string) error {
			shipment.CarrierID = actor.ID
			shipment.CarrierName = actor.DisplayName
			shipment.Status = model.StatusAccepted
			appendEvent(shipment, actor, txID, timestamp, eventDraft{
				Type: model.EventAccepted, Location: fallback(command.Location, shipment.LastLocation),
				Description: fallback(command.Description, "承运方已接单"),
			})
			return nil
		})
}

func (f *Fake) PickupShipment(
	_ context.Context,
	id string,
	command ledger.ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.transition(id, actor, []string{"carrier"}, []string{model.StatusAccepted},
		func(shipment *model.Shipment, txID, timestamp string) error {
			if err := requireAssignedCarrier(*shipment, actor); err != nil {
				return err
			}
			if command.Location == "" {
				return apperror.New(400, "LOCATION_REQUIRED", "Pickup location is required")
			}
			shipment.Status = model.StatusPickedUp
			appendEvent(shipment, actor, txID, timestamp, eventDraft{
				Type: model.EventPickedUp, Location: command.Location,
				Description:  fallback(command.Description, "承运方完成揽收"),
				EvidenceHash: command.EvidenceHash,
			})
			return nil
		})
}

func (f *Fake) AddCheckpoint(
	_ context.Context,
	id string,
	command ledger.ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.transition(id, actor, []string{"carrier"}, []string{model.StatusPickedUp, model.StatusInTransit},
		func(shipment *model.Shipment, txID, timestamp string) error {
			if err := requireAssignedCarrier(*shipment, actor); err != nil {
				return err
			}
			shipment.Status = model.StatusInTransit
			appendEvent(shipment, actor, txID, timestamp, eventDraft{
				Type: model.EventCheckpoint, Location: command.Location, Description: command.Description,
				Temperature: command.Temperature, EvidenceHash: command.EvidenceHash,
			})
			if command.Temperature != nil && shipment.TemperatureRange != nil &&
				(*command.Temperature < shipment.TemperatureRange.Min ||
					*command.Temperature > shipment.TemperatureRange.Max) {
				shipment.Status = model.StatusException
				shipment.AnomalyCount++
				appendEvent(shipment, actor, txID, timestamp, eventDraft{
					Type: model.EventExceptionReported, Location: command.Location,
					Description: fmt.Sprintf(
						"温度 %g°C 超出 %g~%g°C 设定范围",
						*command.Temperature, shipment.TemperatureRange.Min, shipment.TemperatureRange.Max,
					),
					Temperature: command.Temperature, EvidenceHash: command.EvidenceHash,
				})
			}
			return nil
		})
}

func (f *Fake) ReportException(
	_ context.Context,
	id string,
	command ledger.ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.transition(id, actor, []string{"carrier"}, []string{model.StatusInTransit},
		func(shipment *model.Shipment, txID, timestamp string) error {
			if err := requireAssignedCarrier(*shipment, actor); err != nil {
				return err
			}
			if command.Location == "" || command.Description == "" {
				return apperror.New(400, "EXCEPTION_DETAILS_REQUIRED", "Exception location and description are required")
			}
			shipment.Status = model.StatusException
			shipment.AnomalyCount++
			appendEvent(shipment, actor, txID, timestamp, eventDraft{
				Type: model.EventExceptionReported, Location: command.Location,
				Description: command.Description, EvidenceHash: command.EvidenceHash,
			})
			return nil
		})
}

func (f *Fake) ResolveException(
	_ context.Context,
	id string,
	command ledger.ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.transition(id, actor, []string{"carrier"}, []string{model.StatusException},
		func(shipment *model.Shipment, txID, timestamp string) error {
			if err := requireAssignedCarrier(*shipment, actor); err != nil {
				return err
			}
			if command.Location == "" || command.Description == "" {
				return apperror.New(400, "RESOLUTION_DETAILS_REQUIRED", "Resolution location and description are required")
			}
			shipment.Status = model.StatusInTransit
			appendEvent(shipment, actor, txID, timestamp, eventDraft{
				Type: model.EventExceptionResolved, Location: command.Location,
				Description: command.Description, EvidenceHash: command.EvidenceHash,
			})
			return nil
		})
}

func (f *Fake) MarkDelivered(
	_ context.Context,
	id string,
	command ledger.ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.transition(id, actor, []string{"carrier"}, []string{model.StatusInTransit},
		func(shipment *model.Shipment, txID, timestamp string) error {
			if err := requireAssignedCarrier(*shipment, actor); err != nil {
				return err
			}
			if command.Location == "" || command.EvidenceHash == "" {
				return apperror.New(400, "DELIVERY_EVIDENCE_REQUIRED", "Delivery location and evidence hash are required")
			}
			shipment.Status = model.StatusDelivered
			appendEvent(shipment, actor, txID, timestamp, eventDraft{
				Type: model.EventDelivered, Location: command.Location,
				Description:  fallback(command.Description, "货物已送达，等待收货方确认"),
				EvidenceHash: command.EvidenceHash,
			})
			return nil
		})
}

func (f *Fake) ConfirmReceipt(
	_ context.Context,
	id string,
	command ledger.ConfirmCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.transition(id, actor, []string{"receiver"}, []string{model.StatusDelivered},
		func(shipment *model.Shipment, txID, timestamp string) error {
			// Mirror the chaincode guard: only the recorded recipient (or any
			// receiver, for pre-binding legacy shipments) may confirm.
			if shipment.RecipientID != "" && shipment.RecipientID != actor.ID {
				return apperror.New(
					403, "NOT_RECORDED_RECIPIENT",
					"Only the recorded recipient can confirm this shipment",
				)
			}
			sum := sha256.Sum256([]byte(command.DeliveryCode))
			expected, err := hex.DecodeString(shipment.DeliveryCodeHash)
			if err != nil || subtle.ConstantTimeCompare(sum[:], expected) != 1 {
				return apperror.New(400, "INVALID_DELIVERY_CODE", "Delivery code is incorrect")
			}
			shipment.Status = model.StatusReceived
			appendEvent(shipment, actor, txID, timestamp, eventDraft{
				Type: model.EventReceived, Location: fallback(command.Location, shipment.LastLocation),
				Description: fallback(command.Description, "收货方已确认收货"),
			})
			return nil
		})
}

func (f *Fake) CancelShipment(
	_ context.Context,
	id string,
	command ledger.ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.transition(id, actor, []string{"shipper"}, []string{model.StatusCreated},
		func(shipment *model.Shipment, txID, timestamp string) error {
			if shipment.ShipperID != actor.ID {
				return apperror.New(403, "NOT_SHIPMENT_OWNER", "Only the creating shipper can cancel this shipment")
			}
			shipment.Status = model.StatusCancelled
			appendEvent(shipment, actor, txID, timestamp, eventDraft{
				Type: model.EventCancelled, Location: fallback(command.Location, shipment.LastLocation),
				Description: fallback(command.Description, "发货方取消运单"),
			})
			return nil
		})
}

func (f *Fake) transition(
	id string,
	actor model.User,
	roles []string,
	expected []string,
	update func(*model.Shipment, string, string) error,
) (model.LedgerReceipt, error) {
	return f.mutate(func() (model.LedgerReceipt, error) {
		if err := requireRole(actor, roles...); err != nil {
			return model.LedgerReceipt{}, err
		}
		shipment, ok := f.state.Shipments[id]
		if !ok {
			return model.LedgerReceipt{}, apperror.New(404, "SHIPMENT_NOT_FOUND", "Shipment was not found")
		}
		if !contains(expected, shipment.Status) {
			return model.LedgerReceipt{}, apperror.New(
				409, "INVALID_STATE",
				fmt.Sprintf("Shipment is %s; expected %s", shipment.Status, joinOr(expected)),
			)
		}
		timestamp := nowISO()
		txID, err := fakeTxID()
		if err != nil {
			return model.LedgerReceipt{}, err
		}
		if err := update(&shipment, txID, timestamp); err != nil {
			return model.LedgerReceipt{}, err
		}
		shipment.UpdatedAt = timestamp
		f.state.Shipments[id] = shipment
		f.addHistoryLocked(shipment, txID, timestamp)
		return receipt(shipment, txID, timestamp), nil
	})
}

func (f *Fake) mutate(operation func() (model.LedgerReceipt, error)) (model.LedgerReceipt, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	before := cloneState(f.state)
	result, err := operation()
	if err != nil {
		f.state = before
		return model.LedgerReceipt{}, err
	}
	if err := f.persistLocked(); err != nil {
		f.state = before
		return model.LedgerReceipt{}, err
	}
	return result, nil
}

func (f *Fake) addHistoryLocked(shipment model.Shipment, txID, timestamp string) {
	snapshot := cloneShipment(shipment)
	f.state.Histories[shipment.ID] = append(f.state.Histories[shipment.ID], model.ShipmentHistoryEntry{
		TxID: txID, Timestamp: timestamp, IsDelete: false, Value: &snapshot,
	})
}

func appendEvent(
	shipment *model.Shipment,
	actor model.User,
	txID, timestamp string,
	draft eventDraft,
) {
	shipment.Events = append(shipment.Events, model.ShipmentEvent{
		Sequence: len(shipment.Events) + 1, Type: draft.Type, Location: draft.Location,
		Description: draft.Description, ActorID: actor.ID, ActorName: actor.DisplayName,
		MSPID: actor.MSPID, TxID: txID, Timestamp: timestamp,
		Temperature: draft.Temperature, EvidenceHash: draft.EvidenceHash,
	})
	shipment.LastLocation = draft.Location
}

func requireRole(actor model.User, roles ...string) error {
	if !contains(roles, actor.Role) {
		return apperror.New(403, "LEDGER_FORBIDDEN", "The ledger identity cannot perform this action")
	}
	return nil
}

func requireAssignedCarrier(shipment model.Shipment, actor model.User) error {
	if shipment.CarrierID != actor.ID {
		return apperror.New(403, "NOT_ASSIGNED_CARRIER", "Only the assigned carrier can update this shipment")
	}
	return nil
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func joinOr(values []string) string {
	if len(values) == 0 {
		return ""
	}
	result := values[0]
	for _, value := range values[1:] {
		result += " or " + value
	}
	return result
}

func fallback(value, fallbackValue string) string {
	if value == "" {
		return fallbackValue
	}
	return value
}

func fakeTxID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return "fake-" + hex.EncodeToString(value), nil
}

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func receipt(shipment model.Shipment, txID, timestamp string) model.LedgerReceipt {
	return model.LedgerReceipt{
		TransactionID: txID, CommittedAt: timestamp, LedgerMode: "fabric",
		Data: cloneShipment(shipment),
	}
}

func cloneShipment(value model.Shipment) model.Shipment {
	content, _ := json.Marshal(value)
	var result model.Shipment
	_ = json.Unmarshal(content, &result)
	return result
}

func cloneHistory(value []model.ShipmentHistoryEntry) []model.ShipmentHistoryEntry {
	content, _ := json.Marshal(value)
	var result []model.ShipmentHistoryEntry
	_ = json.Unmarshal(content, &result)
	if result == nil {
		return []model.ShipmentHistoryEntry{}
	}
	return result
}

func cloneState(value state) state {
	content, _ := json.Marshal(value)
	var result state
	_ = json.Unmarshal(content, &result)
	return result
}
