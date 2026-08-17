package ledger

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
	"github.com/Viper3-yu/fabric/apps/api/internal/users"
	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
)

type demoState struct {
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

type Demo struct {
	path  string
	mu    sync.RWMutex
	state demoState
}

func NewDemo(path string) (*Demo, error) {
	demo := &Demo{path: path, state: emptyDemoState()}
	if err := demo.load(); err != nil {
		return nil, err
	}
	return demo, nil
}

func emptyDemoState() demoState {
	return demoState{
		Version:   1,
		Shipments: make(map[string]model.Shipment),
		Histories: make(map[string][]model.ShipmentHistoryEntry),
	}
}

func (d *Demo) Mode() string {
	return "demo"
}

// Close releases nothing for the in-memory demo ledger; it exists so the
// demo and Fabric adapters share the same Ledger lifecycle.
func (d *Demo) Close() error {
	return nil
}

func (d *Demo) load() error {
	if err := os.MkdirAll(filepath.Dir(d.path), 0o755); err != nil {
		return err
	}
	content, err := os.ReadFile(d.path)
	if errors.Is(err, os.ErrNotExist) {
		return d.persistLocked()
	}
	if err != nil {
		return apperror.WithDetails(500, "DEMO_LEDGER_CORRUPT", "The demo ledger file cannot be read", map[string]string{"path": d.path})
	}
	var stored demoState
	if err := json.Unmarshal(content, &stored); err != nil ||
		stored.Version != 1 || stored.Shipments == nil || stored.Histories == nil {
		return apperror.WithDetails(500, "DEMO_LEDGER_CORRUPT", "The demo ledger file cannot be read", map[string]string{"path": d.path})
	}
	d.state = stored
	return nil
}

func (d *Demo) persistLocked() error {
	content, err := json.MarshalIndent(d.state, "", "  ")
	if err != nil {
		return err
	}
	content = append(content, '\n')
	// A unique temp file avoids two processes (server + seed) clobbering the
	// same name, and Sync-before-rename keeps the target file whole on crash.
	temporary, err := os.CreateTemp(filepath.Dir(d.path), filepath.Base(d.path)+".*.tmp")
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
	if err := os.Rename(temporaryName, d.path); err != nil {
		return err
	}
	return nil
}

func (d *Demo) Health(context.Context) Health {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return Health{Mode: "demo", Status: "ok", Network: "durable-demo-ledger"}
}

func (d *Demo) GetAllShipments(context.Context, *model.User) ([]model.Shipment, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	result := make([]model.Shipment, 0, len(d.state.Shipments))
	for _, shipment := range d.state.Shipments {
		result = append(result, cloneShipment(shipment))
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt > result[j].UpdatedAt
	})
	return result, nil
}

func (d *Demo) ReadShipment(_ context.Context, id string, _ *model.User) (model.Shipment, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	shipment, ok := d.state.Shipments[id]
	if !ok {
		return model.Shipment{}, apperror.New(404, "SHIPMENT_NOT_FOUND", "Shipment was not found")
	}
	return cloneShipment(shipment), nil
}

func (d *Demo) ReadShipmentByTracking(
	_ context.Context,
	trackingNumber string,
	_ *model.User,
) (model.Shipment, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	for _, shipment := range d.state.Shipments {
		if shipment.TrackingNumber == trackingNumber {
			return cloneShipment(shipment), nil
		}
	}
	return model.Shipment{}, apperror.New(
		404, "TRACKING_NOT_FOUND", "No shipment matches this tracking number",
	)
}

func (d *Demo) GetShipmentHistory(_ context.Context, id string, _ *model.User) ([]model.ShipmentHistoryEntry, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if _, ok := d.state.Shipments[id]; !ok {
		return nil, apperror.New(404, "SHIPMENT_NOT_FOUND", "Shipment was not found")
	}
	return cloneHistory(d.state.Histories[id]), nil
}

func (d *Demo) CreateShipment(
	_ context.Context,
	command CreateShipmentCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return d.mutate(func() (model.LedgerReceipt, error) {
		if err := requireRole(actor, "shipper"); err != nil {
			return model.LedgerReceipt{}, err
		}
		if _, exists := d.state.Shipments[command.ID]; exists {
			return model.LedgerReceipt{}, apperror.New(409, "SHIPMENT_EXISTS", "Shipment ID already exists")
		}
		for _, shipment := range d.state.Shipments {
			if shipment.TrackingNumber == command.TrackingNumber {
				return model.LedgerReceipt{}, apperror.New(409, "TRACKING_NUMBER_EXISTS", "Tracking number already exists")
			}
		}

		timestamp := nowISO()
		txID, err := demoTxID()
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
		d.state.Shipments[shipment.ID] = shipment
		d.addHistoryLocked(shipment, txID, timestamp)
		return demoReceipt(shipment, txID, timestamp), nil
	})
}

func (d *Demo) AcceptShipment(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return d.transition(id, actor, []string{"carrier"}, []string{model.StatusCreated},
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

func (d *Demo) PickupShipment(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return d.transition(id, actor, []string{"carrier"}, []string{model.StatusAccepted},
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

func (d *Demo) AddCheckpoint(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return d.transition(id, actor, []string{"carrier"}, []string{model.StatusPickedUp, model.StatusInTransit},
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

func (d *Demo) ReportException(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return d.transition(id, actor, []string{"carrier"}, []string{model.StatusInTransit},
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

func (d *Demo) ResolveException(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return d.transition(id, actor, []string{"carrier"}, []string{model.StatusException},
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

func (d *Demo) MarkDelivered(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return d.transition(id, actor, []string{"carrier"}, []string{model.StatusInTransit},
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

func (d *Demo) ConfirmReceipt(
	_ context.Context,
	id string,
	command ConfirmCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return d.transition(id, actor, []string{"receiver"}, []string{model.StatusDelivered},
		func(shipment *model.Shipment, txID, timestamp string) error {
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

func (d *Demo) CancelShipment(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return d.transition(id, actor, []string{"shipper"}, []string{model.StatusCreated},
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

func (d *Demo) transition(
	id string,
	actor model.User,
	roles []string,
	expected []string,
	update func(*model.Shipment, string, string) error,
) (model.LedgerReceipt, error) {
	return d.mutate(func() (model.LedgerReceipt, error) {
		if err := requireRole(actor, roles...); err != nil {
			return model.LedgerReceipt{}, err
		}
		shipment, ok := d.state.Shipments[id]
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
		txID, err := demoTxID()
		if err != nil {
			return model.LedgerReceipt{}, err
		}
		if err := update(&shipment, txID, timestamp); err != nil {
			return model.LedgerReceipt{}, err
		}
		shipment.UpdatedAt = timestamp
		d.state.Shipments[id] = shipment
		d.addHistoryLocked(shipment, txID, timestamp)
		return demoReceipt(shipment, txID, timestamp), nil
	})
}

func (d *Demo) mutate(operation func() (model.LedgerReceipt, error)) (model.LedgerReceipt, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	before := cloneState(d.state)
	result, err := operation()
	if err != nil {
		d.state = before
		return model.LedgerReceipt{}, err
	}
	if err := d.persistLocked(); err != nil {
		d.state = before
		return model.LedgerReceipt{}, err
	}
	return result, nil
}

func (d *Demo) addHistoryLocked(shipment model.Shipment, txID, timestamp string) {
	snapshot := cloneShipment(shipment)
	d.state.Histories[shipment.ID] = append(d.state.Histories[shipment.ID], model.ShipmentHistoryEntry{
		TxID: txID, Timestamp: timestamp, IsDelete: false, Value: &snapshot,
	})
}

func (d *Demo) Reset() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	before := d.state
	d.state = emptyDemoState()
	if err := d.persistLocked(); err != nil {
		d.state = before
		return err
	}
	return nil
}

func SeedDemo(demo *Demo, force bool) (bool, int, error) {
	if force {
		if err := demo.Reset(); err != nil {
			return false, 0, err
		}
	}
	existing, err := demo.GetAllShipments(context.Background(), nil)
	if err != nil {
		return false, 0, err
	}
	if len(existing) > 0 {
		return false, len(existing), nil
	}
	shipper := users.ByUsername["shipper"].User
	carrier := users.ByUsername["carrier"].User
	commonOrigin := model.Address{
		Province: "上海市", City: "上海市", District: "浦东新区",
		Detail: "张江物流园 1 号库", ContactName: "李发货", ContactPhoneMasked: "138****0001",
	}
	commonDestination := model.Address{
		Province: "江苏省", City: "南京市", District: "玄武区",
		Detail: "珠江路 88 号", ContactName: "演示收货人", ContactPhoneMasked: "139****0002",
	}
	tempRange := &model.TemperatureRange{Min: 2, Max: 8, Unit: "C"}
	documentHash := sha256Hex("jixin-demo-document")

	first, err := demo.CreateShipment(context.Background(), CreateShipmentCommand{
		ID: "shipment-demo-transit", TrackingNumber: "JX202607200001",
		Origin: commonOrigin, Destination: commonDestination,
		Goods:           model.GoodsInfo{Name: "生鲜样品", Category: "冷链", Quantity: 4, WeightKG: 16},
		RecipientMasked: "演** · 139****0002", ExpectedDeliveryDate: "2026-07-23",
		TemperatureRange: tempRange, DocumentHash: documentHash, DeliveryCodeHash: sha256Hex("246810"),
	}, shipper)
	if err != nil {
		return false, 0, err
	}
	_, err = demo.AcceptShipment(context.Background(), first.Data.ID, ActionCommand{}, carrier)
	if err != nil {
		return false, 0, err
	}
	_, err = demo.PickupShipment(context.Background(), first.Data.ID, ActionCommand{Location: "上海张江物流园"}, carrier)
	if err != nil {
		return false, 0, err
	}
	normal := 5.2
	_, err = demo.AddCheckpoint(context.Background(), first.Data.ID, ActionCommand{
		Location: "昆山中转中心", Description: "完成干线中转", Temperature: &normal,
	}, carrier)
	if err != nil {
		return false, 0, err
	}

	second, err := demo.CreateShipment(context.Background(), CreateShipmentCommand{
		ID: "shipment-demo-exception", TrackingNumber: "JX202607200002",
		Origin: commonOrigin, Destination: commonDestination,
		Goods:           model.GoodsInfo{Name: "医药试剂", Category: "医药", Quantity: 2, WeightKG: 3.5},
		RecipientMasked: "演** · 139****0002", ExpectedDeliveryDate: "2026-07-23",
		TemperatureRange: tempRange, DocumentHash: documentHash, DeliveryCodeHash: sha256Hex("135790"),
	}, shipper)
	if err != nil {
		return false, 0, err
	}
	_, err = demo.AcceptShipment(context.Background(), second.Data.ID, ActionCommand{}, carrier)
	if err != nil {
		return false, 0, err
	}
	_, err = demo.PickupShipment(context.Background(), second.Data.ID, ActionCommand{Location: "上海张江物流园"}, carrier)
	if err != nil {
		return false, 0, err
	}
	abnormal := 10.4
	_, err = demo.AddCheckpoint(context.Background(), second.Data.ID, ActionCommand{
		Location: "苏州温控仓", Description: "运输节点人工录入温度", Temperature: &abnormal,
	}, carrier)
	if err != nil {
		return false, 0, err
	}
	return true, 2, nil
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

func demoTxID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return "demo-" + hex.EncodeToString(value), nil
}

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func demoReceipt(shipment model.Shipment, txID, timestamp string) model.LedgerReceipt {
	return model.LedgerReceipt{
		TransactionID: txID, CommittedAt: timestamp, LedgerMode: "demo",
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

func cloneState(value demoState) demoState {
	content, _ := json.Marshal(value)
	var result demoState
	_ = json.Unmarshal(content, &result)
	return result
}
