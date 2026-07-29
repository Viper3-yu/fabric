package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

const (
	shipmentKeyPrefix = "SHIPMENT:"
	trackingKeyPrefix = "TRACKING:"
	keyRangeEnd       = shipmentKeyPrefix + "\uffff"
	org1MSP           = "Org1MSP"
	org2MSP           = "Org2MSP"
	maxPayloadBytes   = 64 * 1024
)

type LogisticsContract struct {
	contractapi.Contract
}

type actor struct {
	ID   string
	Name string
}

type actionInput struct {
	ActorID      string   `json:"actorId"`
	ActorName    string   `json:"actorName"`
	CarrierID    string   `json:"carrierId"`
	CarrierName  string   `json:"carrierName"`
	Location     string   `json:"location"`
	Description  string   `json:"description"`
	Temperature  *float64 `json:"temperature"`
	EvidenceHash string   `json:"evidenceHash"`
}

type createShipmentInput struct {
	ID                   string                  `json:"id"`
	TrackingNumber       string                  `json:"trackingNumber"`
	ShipperID            string                  `json:"shipperId"`
	ShipperName          string                  `json:"shipperName"`
	Origin               model.Address           `json:"origin"`
	Destination          model.Address           `json:"destination"`
	Goods                model.GoodsInfo         `json:"goods"`
	RecipientMasked      string                  `json:"recipientMasked"`
	ExpectedDeliveryDate string                  `json:"expectedDeliveryDate"`
	TemperatureRange     *model.TemperatureRange `json:"temperatureRange"`
	DeliveryCodeHash     string                  `json:"deliveryCodeHash"`
	DocumentHash         string                  `json:"documentHash"`
	Location             string                  `json:"location"`
	Description          string                  `json:"description"`
}

func (c *LogisticsContract) CreateShipment(
	ctx contractapi.TransactionContextInterface,
	inputJSON string,
) (string, error) {
	if err := requireMSP(ctx, org1MSP, "CreateShipment"); err != nil {
		return "", err
	}
	input, err := parseCreateShipment(inputJSON)
	if err != nil {
		return "", err
	}
	shipmentKey := shipmentKey(input.ID)
	trackingKey := trackingKey(input.TrackingNumber)
	if exists, err := stateExists(ctx, shipmentKey); err != nil {
		return "", err
	} else if exists {
		return "", fmt.Errorf("CreateShipment failed: shipment id %q already exists", input.ID)
	}
	if exists, err := stateExists(ctx, trackingKey); err != nil {
		return "", err
	} else if exists {
		return "", fmt.Errorf(
			"CreateShipment failed: tracking number %q already exists",
			input.TrackingNumber,
		)
	}

	timestamp, err := transactionTimestamp(ctx)
	if err != nil {
		return "", err
	}
	mspID, err := currentMSP(ctx)
	if err != nil {
		return "", err
	}
	location := input.Location
	if location == "" {
		location = addressLocation(input.Origin)
	}
	description := input.Description
	if description == "" {
		description = "Shipment created"
	}
	created := model.ShipmentEvent{
		Sequence: 1, Type: model.EventCreated, Location: location, Description: description,
		ActorID: input.ShipperID, ActorName: input.ShipperName, MSPID: mspID,
		TxID: ctx.GetStub().GetTxID(), Timestamp: timestamp, EvidenceHash: input.DocumentHash,
	}
	shipment := model.Shipment{
		DocType: "shipment", ID: input.ID, TrackingNumber: input.TrackingNumber,
		Status: model.StatusCreated, ShipperID: input.ShipperID, ShipperName: input.ShipperName,
		Origin: input.Origin, Destination: input.Destination, Goods: input.Goods,
		RecipientMasked: input.RecipientMasked, ExpectedDeliveryDate: input.ExpectedDeliveryDate,
		TemperatureRange: input.TemperatureRange, DeliveryCodeHash: input.DeliveryCodeHash,
		DocumentHash: input.DocumentHash, Events: []model.ShipmentEvent{created},
		LastLocation: location, CreatedAt: timestamp, UpdatedAt: timestamp,
	}
	content, err := json.Marshal(shipment)
	if err != nil {
		return "", err
	}
	if err := ctx.GetStub().PutState(shipmentKey, content); err != nil {
		return "", err
	}
	if err := ctx.GetStub().PutState(trackingKey, []byte(input.ID)); err != nil {
		return "", err
	}
	if err := emitShipmentEvent(ctx, shipment, model.EventCreated, []model.ShipmentEvent{created}, timestamp); err != nil {
		return "", err
	}
	return string(content), nil
}

func (c *LogisticsContract) AcceptShipment(
	ctx contractapi.TransactionContextInterface,
	shipmentID, inputJSON string,
) (string, error) {
	if err := requireMSP(ctx, org2MSP, "AcceptShipment"); err != nil {
		return "", err
	}
	input, err := parseAction(inputJSON, "AcceptShipment input")
	if err != nil {
		return "", err
	}
	if err := requireString(input.CarrierID, "carrierId", 128); err != nil {
		return "", err
	}
	if err := requireString(input.CarrierName, "carrierName", 128); err != nil {
		return "", err
	}
	if input.ActorID == "" {
		input.ActorID = input.CarrierID
	}
	if input.ActorName == "" {
		input.ActorName = input.CarrierName
	}
	key, shipment, err := loadShipment(ctx, shipmentID)
	if err != nil {
		return "", err
	}
	if err := requireStatus(shipment, "AcceptShipment", model.StatusCreated); err != nil {
		return "", err
	}
	timestamp, event, err := buildEvent(
		ctx, shipment, model.EventAccepted, input,
		fallback(input.Location, shipment.LastLocation),
		fallback(input.Description, "Carrier accepted the shipment"),
	)
	if err != nil {
		return "", err
	}
	shipment.CarrierID = input.CarrierID
	shipment.CarrierName = input.CarrierName
	shipment.Status = model.StatusAccepted
	appendEvents(&shipment, []model.ShipmentEvent{event}, timestamp)
	return commitMutation(ctx, key, shipment, model.EventAccepted, []model.ShipmentEvent{event}, timestamp)
}

func (c *LogisticsContract) PickupShipment(
	ctx contractapi.TransactionContextInterface,
	shipmentID, inputJSON string,
) (string, error) {
	if err := requireMSP(ctx, org2MSP, "PickupShipment"); err != nil {
		return "", err
	}
	input, err := parseAction(inputJSON, "PickupShipment input")
	if err != nil {
		return "", err
	}
	if err := validateActor(input); err != nil {
		return "", err
	}
	if err := requireString(input.Location, "location", 256); err != nil {
		return "", err
	}
	if err := optionalHash(input.EvidenceHash, "evidenceHash"); err != nil {
		return "", err
	}
	key, shipment, err := loadShipment(ctx, shipmentID)
	if err != nil {
		return "", err
	}
	if err := requireStatus(shipment, "PickupShipment", model.StatusAccepted); err != nil {
		return "", err
	}
	if err := requireAssignedCarrier(shipment, input, "PickupShipment"); err != nil {
		return "", err
	}
	timestamp, event, err := buildEvent(
		ctx, shipment, model.EventPickedUp, input, input.Location,
		fallback(input.Description, "Shipment picked up"),
	)
	if err != nil {
		return "", err
	}
	shipment.Status = model.StatusPickedUp
	appendEvents(&shipment, []model.ShipmentEvent{event}, timestamp)
	return commitMutation(ctx, key, shipment, model.EventPickedUp, []model.ShipmentEvent{event}, timestamp)
}

func (c *LogisticsContract) AddCheckpoint(
	ctx contractapi.TransactionContextInterface,
	shipmentID, inputJSON string,
) (string, error) {
	if err := requireMSP(ctx, org2MSP, "AddCheckpoint"); err != nil {
		return "", err
	}
	input, err := parseAction(inputJSON, "AddCheckpoint input")
	if err != nil {
		return "", err
	}
	if err := validateActor(input); err != nil {
		return "", err
	}
	if err := requireString(input.Location, "location", 256); err != nil {
		return "", err
	}
	if err := requireString(input.Description, "description", 500); err != nil {
		return "", err
	}
	if input.Temperature != nil && (*input.Temperature < -273.15 || *input.Temperature > 10000) {
		return "", fmt.Errorf("Invalid temperature: expected a value from -273.15 to 10000")
	}
	if err := optionalHash(input.EvidenceHash, "evidenceHash"); err != nil {
		return "", err
	}
	key, shipment, err := loadShipment(ctx, shipmentID)
	if err != nil {
		return "", err
	}
	if err := requireStatus(shipment, "AddCheckpoint", model.StatusPickedUp, model.StatusInTransit); err != nil {
		return "", err
	}
	if err := requireAssignedCarrier(shipment, input, "AddCheckpoint"); err != nil {
		return "", err
	}
	timestamp, checkpoint, err := buildEvent(
		ctx, shipment, model.EventCheckpoint, input, input.Location, input.Description,
	)
	if err != nil {
		return "", err
	}
	events := []model.ShipmentEvent{checkpoint}
	shipment.Status = model.StatusInTransit
	if input.Temperature != nil && shipment.TemperatureRange != nil &&
		(*input.Temperature < shipment.TemperatureRange.Min ||
			*input.Temperature > shipment.TemperatureRange.Max) {
		mspID, err := currentMSP(ctx)
		if err != nil {
			return "", err
		}
		exception := model.ShipmentEvent{
			Sequence: len(shipment.Events) + 2, Type: model.EventExceptionReported,
			Location: input.Location,
			Description: fmt.Sprintf(
				"Temperature %g C is outside allowed range %g..%g C",
				*input.Temperature, shipment.TemperatureRange.Min, shipment.TemperatureRange.Max,
			),
			ActorID: input.ActorID, ActorName: input.ActorName, MSPID: mspID,
			TxID: ctx.GetStub().GetTxID(), Timestamp: timestamp,
			Temperature: input.Temperature, EvidenceHash: strings.ToLower(input.EvidenceHash),
		}
		events = append(events, exception)
		shipment.Status = model.StatusException
		shipment.AnomalyCount++
	}
	appendEvents(&shipment, events, timestamp)
	return commitMutation(ctx, key, shipment, "ADD_CHECKPOINT", events, timestamp)
}

func (c *LogisticsContract) ReportException(
	ctx contractapi.TransactionContextInterface,
	shipmentID, inputJSON string,
) (string, error) {
	return c.carrierMutation(
		ctx, "ReportException", shipmentID, inputJSON,
		[]string{model.StatusInTransit}, model.StatusException, model.EventExceptionReported,
		true, true, true,
	)
}

func (c *LogisticsContract) ResolveException(
	ctx contractapi.TransactionContextInterface,
	shipmentID, inputJSON string,
) (string, error) {
	return c.carrierMutation(
		ctx, "ResolveException", shipmentID, inputJSON,
		[]string{model.StatusException}, model.StatusInTransit, model.EventExceptionResolved,
		true, true, false,
	)
}

func (c *LogisticsContract) MarkDelivered(
	ctx contractapi.TransactionContextInterface,
	shipmentID, inputJSON string,
) (string, error) {
	if err := requireMSP(ctx, org2MSP, "MarkDelivered"); err != nil {
		return "", err
	}
	input, err := parseAction(inputJSON, "MarkDelivered input")
	if err != nil {
		return "", err
	}
	if err := validateActor(input); err != nil {
		return "", err
	}
	if err := requireString(input.Location, "location", 256); err != nil {
		return "", err
	}
	if err := requiredHash(input.EvidenceHash, "evidenceHash"); err != nil {
		return "", err
	}
	key, shipment, err := loadShipment(ctx, shipmentID)
	if err != nil {
		return "", err
	}
	if err := requireStatus(shipment, "MarkDelivered", model.StatusInTransit); err != nil {
		return "", err
	}
	if err := requireAssignedCarrier(shipment, input, "MarkDelivered"); err != nil {
		return "", err
	}
	timestamp, event, err := buildEvent(
		ctx, shipment, model.EventDelivered, input, input.Location,
		fallback(input.Description, "Shipment delivered"),
	)
	if err != nil {
		return "", err
	}
	shipment.Status = model.StatusDelivered
	appendEvents(&shipment, []model.ShipmentEvent{event}, timestamp)
	return commitMutation(ctx, key, shipment, model.EventDelivered, []model.ShipmentEvent{event}, timestamp)
}

func (c *LogisticsContract) ConfirmReceipt(
	ctx contractapi.TransactionContextInterface,
	shipmentID, inputJSON string,
) (string, error) {
	if err := requireMSP(ctx, org1MSP, "ConfirmReceipt"); err != nil {
		return "", err
	}
	input, err := parseAction(inputJSON, "ConfirmReceipt input")
	if err != nil {
		return "", err
	}
	if err := validateActor(input); err != nil {
		return "", err
	}
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return "", err
	}
	code := strings.TrimSpace(string(transient["deliveryCode"]))
	if len(code) < 4 || len(code) > 128 {
		return "", fmt.Errorf("ConfirmReceipt failed: deliveryCode must be supplied in Fabric transient data")
	}
	key, shipment, err := loadShipment(ctx, shipmentID)
	if err != nil {
		return "", err
	}
	if err := requireStatus(shipment, "ConfirmReceipt", model.StatusDelivered); err != nil {
		return "", err
	}
	actual := sha256.Sum256([]byte(code))
	expected, err := hex.DecodeString(shipment.DeliveryCodeHash)
	if err != nil || len(expected) != len(actual) ||
		subtle.ConstantTimeCompare(actual[:], expected) != 1 {
		return "", fmt.Errorf("ConfirmReceipt failed: delivery code is incorrect")
	}
	timestamp, event, err := buildEvent(
		ctx, shipment, model.EventReceived, input,
		fallback(input.Location, shipment.LastLocation),
		fallback(input.Description, "Recipient confirmed receipt"),
	)
	if err != nil {
		return "", err
	}
	shipment.Status = model.StatusReceived
	appendEvents(&shipment, []model.ShipmentEvent{event}, timestamp)
	return commitMutation(ctx, key, shipment, model.EventReceived, []model.ShipmentEvent{event}, timestamp)
}

func (c *LogisticsContract) CancelShipment(
	ctx contractapi.TransactionContextInterface,
	shipmentID, inputJSON string,
) (string, error) {
	if err := requireMSP(ctx, org1MSP, "CancelShipment"); err != nil {
		return "", err
	}
	input, err := parseAction(inputJSON, "CancelShipment input")
	if err != nil {
		return "", err
	}
	if err := validateActor(input); err != nil {
		return "", err
	}
	key, shipment, err := loadShipment(ctx, shipmentID)
	if err != nil {
		return "", err
	}
	if err := requireStatus(shipment, "CancelShipment", model.StatusCreated); err != nil {
		return "", err
	}
	if input.ActorID != shipment.ShipperID {
		return "", fmt.Errorf(
			"CancelShipment failed: actor %q is not authorized; shipment %q shipper is %q",
			input.ActorID, shipment.ID, shipment.ShipperID,
		)
	}
	timestamp, event, err := buildEvent(
		ctx, shipment, model.EventCancelled, input,
		fallback(input.Location, shipment.LastLocation),
		fallback(input.Description, "Shipment cancelled"),
	)
	if err != nil {
		return "", err
	}
	shipment.Status = model.StatusCancelled
	appendEvents(&shipment, []model.ShipmentEvent{event}, timestamp)
	return commitMutation(ctx, key, shipment, model.EventCancelled, []model.ShipmentEvent{event}, timestamp)
}

func (c *LogisticsContract) ReadShipment(
	ctx contractapi.TransactionContextInterface,
	shipmentIDOrTrackingNumber string,
) (string, error) {
	_, shipment, err := loadShipment(ctx, shipmentIDOrTrackingNumber)
	if err != nil {
		return "", err
	}
	content, err := json.Marshal(shipment)
	return string(content), err
}

func (c *LogisticsContract) Health(
	ctx contractapi.TransactionContextInterface,
) (string, error) {
	mspID, err := currentMSP(ctx)
	if err != nil {
		return "", err
	}
	content, err := json.Marshal(map[string]string{
		"status": "ok", "contract": "logistics", "mspId": mspID,
	})
	return string(content), err
}

func (c *LogisticsContract) GetAllShipments(
	ctx contractapi.TransactionContextInterface,
) (string, error) {
	iterator, err := ctx.GetStub().GetStateByRange(shipmentKeyPrefix, keyRangeEnd)
	if err != nil {
		return "", err
	}
	defer iterator.Close()
	shipments := make([]model.Shipment, 0)
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return "", err
		}
		shipment, err := decodeShipment(item.Value, item.Key)
		if err != nil {
			return "", err
		}
		shipments = append(shipments, shipment)
	}
	sort.Slice(shipments, func(i, j int) bool {
		return shipments[i].ID < shipments[j].ID
	})
	content, err := json.Marshal(shipments)
	return string(content), err
}

func (c *LogisticsContract) GetShipmentHistory(
	ctx contractapi.TransactionContextInterface,
	shipmentIDOrTrackingNumber string,
) (string, error) {
	key, _, err := loadShipment(ctx, shipmentIDOrTrackingNumber)
	if err != nil {
		return "", err
	}
	iterator, err := ctx.GetStub().GetHistoryForKey(key)
	if err != nil {
		return "", err
	}
	defer iterator.Close()
	history := make([]model.ShipmentHistoryEntry, 0)
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return "", err
		}
		timestamp, err := formatTimestamp(item.Timestamp.Seconds, int32(item.Timestamp.Nanos))
		if err != nil {
			return "", err
		}
		entry := model.ShipmentHistoryEntry{
			TxID: item.TxId, Timestamp: timestamp, IsDelete: item.IsDelete,
		}
		if !item.IsDelete {
			shipment, err := decodeShipment(item.Value, key)
			if err != nil {
				return "", err
			}
			entry.Value = &shipment
		}
		history = append(history, entry)
	}
	content, err := json.Marshal(history)
	return string(content), err
}

func (c *LogisticsContract) carrierMutation(
	ctx contractapi.TransactionContextInterface,
	operation, shipmentID, inputJSON string,
	allowed []string,
	nextStatus, eventType string,
	requireLocation, requireDescription, incrementAnomaly bool,
) (string, error) {
	if err := requireMSP(ctx, org2MSP, operation); err != nil {
		return "", err
	}
	input, err := parseAction(inputJSON, operation+" input")
	if err != nil {
		return "", err
	}
	if err := validateActor(input); err != nil {
		return "", err
	}
	if requireLocation {
		if err := requireString(input.Location, "location", 256); err != nil {
			return "", err
		}
	}
	if requireDescription {
		if err := requireString(input.Description, "description", 500); err != nil {
			return "", err
		}
	}
	if err := optionalHash(input.EvidenceHash, "evidenceHash"); err != nil {
		return "", err
	}
	key, shipment, err := loadShipment(ctx, shipmentID)
	if err != nil {
		return "", err
	}
	if err := requireStatus(shipment, operation, allowed...); err != nil {
		return "", err
	}
	if err := requireAssignedCarrier(shipment, input, operation); err != nil {
		return "", err
	}
	timestamp, event, err := buildEvent(
		ctx, shipment, eventType, input, input.Location, input.Description,
	)
	if err != nil {
		return "", err
	}
	shipment.Status = nextStatus
	if incrementAnomaly {
		shipment.AnomalyCount++
	}
	appendEvents(&shipment, []model.ShipmentEvent{event}, timestamp)
	return commitMutation(ctx, key, shipment, eventType, []model.ShipmentEvent{event}, timestamp)
}

func buildEvent(
	ctx contractapi.TransactionContextInterface,
	shipment model.Shipment,
	eventType string,
	input actionInput,
	location, description string,
) (string, model.ShipmentEvent, error) {
	timestamp, err := transactionTimestamp(ctx)
	if err != nil {
		return "", model.ShipmentEvent{}, err
	}
	mspID, err := currentMSP(ctx)
	if err != nil {
		return "", model.ShipmentEvent{}, err
	}
	return timestamp, model.ShipmentEvent{
		Sequence: len(shipment.Events) + 1, Type: eventType, Location: location,
		Description: description, ActorID: input.ActorID, ActorName: input.ActorName,
		MSPID: mspID, TxID: ctx.GetStub().GetTxID(), Timestamp: timestamp,
		Temperature: input.Temperature, EvidenceHash: strings.ToLower(input.EvidenceHash),
	}, nil
}

func appendEvents(shipment *model.Shipment, events []model.ShipmentEvent, timestamp string) {
	shipment.Events = append(shipment.Events, events...)
	if len(events) > 0 {
		shipment.LastLocation = events[len(events)-1].Location
	}
	shipment.UpdatedAt = timestamp
}

func commitMutation(
	ctx contractapi.TransactionContextInterface,
	key string,
	shipment model.Shipment,
	action string,
	events []model.ShipmentEvent,
	timestamp string,
) (string, error) {
	content, err := json.Marshal(shipment)
	if err != nil {
		return "", err
	}
	if err := ctx.GetStub().PutState(key, content); err != nil {
		return "", err
	}
	if err := emitShipmentEvent(ctx, shipment, action, events, timestamp); err != nil {
		return "", err
	}
	return string(content), nil
}

func emitShipmentEvent(
	ctx contractapi.TransactionContextInterface,
	shipment model.Shipment,
	action string,
	events []model.ShipmentEvent,
	timestamp string,
) error {
	mspID, err := currentMSP(ctx)
	if err != nil {
		return err
	}
	payload := model.ChaincodeShipmentEvent{
		EventName: "ShipmentEvent", Action: action, ShipmentID: shipment.ID,
		TrackingNumber: shipment.TrackingNumber, Status: shipment.Status,
		TxID: ctx.GetStub().GetTxID(), Timestamp: timestamp, MSPID: mspID, Events: events,
	}
	content, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return ctx.GetStub().SetEvent("ShipmentEvent", content)
}

func loadShipment(
	ctx contractapi.TransactionContextInterface,
	idOrTracking string,
) (string, model.Shipment, error) {
	lookup, err := identifier(idOrTracking, "shipment id or tracking number")
	if err != nil {
		return "", model.Shipment{}, err
	}
	directKey := shipmentKey(lookup)
	content, err := ctx.GetStub().GetState(directKey)
	if err != nil {
		return "", model.Shipment{}, err
	}
	if len(content) > 0 {
		shipment, err := decodeShipment(content, directKey)
		return directKey, shipment, err
	}
	indexedID, err := ctx.GetStub().GetState(trackingKey(lookup))
	if err != nil {
		return "", model.Shipment{}, err
	}
	if len(indexedID) == 0 {
		return "", model.Shipment{}, fmt.Errorf("Shipment %q does not exist", lookup)
	}
	resolvedKey := shipmentKey(string(indexedID))
	content, err = ctx.GetStub().GetState(resolvedKey)
	if err != nil {
		return "", model.Shipment{}, err
	}
	if len(content) == 0 {
		return "", model.Shipment{}, fmt.Errorf(
			"Ledger integrity error: tracking number %q points to missing shipment %q",
			lookup, string(indexedID),
		)
	}
	shipment, err := decodeShipment(content, resolvedKey)
	return resolvedKey, shipment, err
}

func decodeShipment(content []byte, key string) (model.Shipment, error) {
	var shipment model.Shipment
	if err := json.Unmarshal(content, &shipment); err != nil {
		return model.Shipment{}, fmt.Errorf(
			"Ledger integrity error: state at %q is not valid JSON", key,
		)
	}
	if shipment.DocType != "shipment" || shipment.ID == "" {
		return model.Shipment{}, fmt.Errorf(
			"Ledger integrity error: state at %q is not a shipment document", key,
		)
	}
	return shipment, nil
}

func stateExists(ctx contractapi.TransactionContextInterface, key string) (bool, error) {
	content, err := ctx.GetStub().GetState(key)
	return len(content) > 0, err
}

func shipmentKey(id string) string {
	return shipmentKeyPrefix + id
}

func trackingKey(trackingNumber string) string {
	return trackingKeyPrefix + trackingNumber
}

func currentMSP(ctx contractapi.TransactionContextInterface) (string, error) {
	mspID, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return "", fmt.Errorf("unable to determine caller MSP: %w", err)
	}
	return mspID, nil
}

func requireMSP(
	ctx contractapi.TransactionContextInterface,
	expected, operation string,
) error {
	actual, err := currentMSP(ctx)
	if err != nil {
		return err
	}
	if actual != expected {
		return fmt.Errorf(
			"%s is restricted to %s; caller belongs to %s",
			operation, expected, fallback(actual, "an unknown MSP"),
		)
	}
	return nil
}

func transactionTimestamp(ctx contractapi.TransactionContextInterface) (string, error) {
	timestamp, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return "", err
	}
	return formatTimestamp(timestamp.Seconds, int32(timestamp.Nanos))
}

func formatTimestamp(seconds int64, nanos int32) (string, error) {
	if nanos < 0 || nanos >= 1_000_000_000 {
		return "", fmt.Errorf("Ledger integrity error: timestamp has invalid nanoseconds")
	}
	value := time.Unix(seconds, int64(nanos)).UTC()
	if value.Year() < 1 || value.Year() > 9999 {
		return "", fmt.Errorf("Ledger integrity error: timestamp is outside the supported date range")
	}
	return value.Format("2006-01-02T15:04:05.000Z"), nil
}

func requireStatus(shipment model.Shipment, operation string, allowed ...string) error {
	for _, status := range allowed {
		if shipment.Status == status {
			return nil
		}
	}
	return fmt.Errorf(
		"%s failed: shipment %q must be in %s status; current status is %s",
		operation, shipment.ID, strings.Join(allowed, " or "), shipment.Status,
	)
}

func requireAssignedCarrier(
	shipment model.Shipment,
	input actionInput,
	operation string,
) error {
	if shipment.CarrierID == "" {
		return fmt.Errorf("%s failed: shipment %q does not have an assigned carrier", operation, shipment.ID)
	}
	if shipment.CarrierID != input.ActorID {
		return fmt.Errorf(
			"%s failed: actor %q is not authorized; shipment %q assigned carrier is %q",
			operation, input.ActorID, shipment.ID, shipment.CarrierID,
		)
	}
	return nil
}

func fallback(value, fallbackValue string) string {
	if strings.TrimSpace(value) == "" {
		return fallbackValue
	}
	return strings.TrimSpace(value)
}
