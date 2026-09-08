package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

const (
	parcelKeyPrefix           = "PARCEL:"
	unitKeyPrefix             = "UNIT:"
	handoverKeyPrefix         = "HANDOVER:"
	shipmentParcelKeyPrefix   = "SHIPMENTPARCEL:"
	shipmentUnitKeyPrefix     = "SHIPMENTUNIT:"
	shipmentHandoverKeyPrefix = "SHIPMENTHANDOVER:"
	linkKeySeparator          = ":"
	linkRangeEndSuffix        = "\uffff"

	maxCollabParcelsPerUnit = 100
)

func parcelKey(id string) string {
	return parcelKeyPrefix + id
}

func unitKey(id string) string {
	return unitKeyPrefix + id
}

func handoverKey(id string) string {
	return handoverKeyPrefix + id
}

func shipmentParcelKey(shipmentID, parcelID string) string {
	return shipmentParcelKeyPrefix + shipmentID + linkKeySeparator + parcelID
}

func shipmentUnitKey(shipmentID, unitID string) string {
	return shipmentUnitKeyPrefix + shipmentID + linkKeySeparator + unitID
}

func shipmentHandoverKey(shipmentID, handoverID string) string {
	return shipmentHandoverKeyPrefix + shipmentID + linkKeySeparator + handoverID
}

func linkKeyRange(prefix, shipmentID string) (string, string) {
	start := prefix + shipmentID + linkKeySeparator
	return start, start + linkRangeEndSuffix
}

// AddParcel registers a parcel under a shipment before it leaves the shipper.
func (c *LogisticsContract) AddParcel(
	ctx contractapi.TransactionContextInterface,
	shipmentID, parcelID, description string,
) (string, error) {
	if err := requireMSP(ctx, org1MSP, "AddParcel"); err != nil {
		return "", err
	}
	parcelID, err := identifier(parcelID, "parcel id")
	if err != nil {
		return "", err
	}
	_, shipment, err := loadShipment(ctx, shipmentID)
	if err != nil {
		return "", err
	}
	if err := requireStatus(shipment, "AddParcel", model.StatusCreated, model.StatusAccepted); err != nil {
		return "", err
	}
	if description != "" {
		if err := requireString(description, "description", 200); err != nil {
			return "", err
		}
	}
	if exists, err := stateExists(ctx, parcelKey(parcelID)); err != nil {
		return "", err
	} else if exists {
		return "", fmt.Errorf("AddParcel failed: parcel id %q already exists", parcelID)
	}

	timestamp, err := transactionTimestamp(ctx)
	if err != nil {
		return "", err
	}
	parcel := model.Parcel{
		DocType: "parcel", ID: parcelID, ShipmentID: shipment.ID, Description: description,
		Status: model.ParcelCreated, TxID: ctx.GetStub().GetTxID(),
		CreatedAt: timestamp, UpdatedAt: timestamp,
	}
	if err := putCollab(ctx, parcelKey(parcelID), shipmentParcelKey(shipment.ID, parcelID), parcel); err != nil {
		return "", err
	}
	return marshalCollab(parcel)
}

// PackParcels aggregates parcels of one shipment into a logistics unit.
func (c *LogisticsContract) PackParcels(
	ctx contractapi.TransactionContextInterface,
	shipmentID, unitID, unitType, parcelIDsJSON string,
) (string, error) {
	if err := requireMSP(ctx, org1MSP, "PackParcels"); err != nil {
		return "", err
	}
	unitID, err := identifier(unitID, "unit id")
	if err != nil {
		return "", err
	}
	_, shipment, err := loadShipment(ctx, shipmentID)
	if err != nil {
		return "", err
	}
	if err := requireStatus(shipment, "PackParcels", model.StatusCreated, model.StatusAccepted); err != nil {
		return "", err
	}
	if err := requireString(unitType, "unitType", 64); err != nil {
		return "", err
	}
	var parcelIDs []string
	if err := json.Unmarshal([]byte(parcelIDsJSON), &parcelIDs); err != nil {
		return "", fmt.Errorf("Invalid parcelIds: expected a JSON array of parcel ids")
	}
	if len(parcelIDs) == 0 || len(parcelIDs) > maxCollabParcelsPerUnit {
		return "", fmt.Errorf(
			"Invalid parcelIds: expected between 1 and %d entries", maxCollabParcelsPerUnit,
		)
	}
	seen := make(map[string]struct{}, len(parcelIDs))
	parcels := make([]model.Parcel, 0, len(parcelIDs))
	for _, rawID := range parcelIDs {
		parcelID, err := identifier(rawID, "parcel id")
		if err != nil {
			return "", err
		}
		if _, dup := seen[parcelID]; dup {
			return "", fmt.Errorf("PackParcels failed: parcel id %q listed twice", parcelID)
		}
		seen[parcelID] = struct{}{}
		content, err := ctx.GetStub().GetState(parcelKey(parcelID))
		if err != nil {
			return "", err
		}
		if len(content) == 0 {
			return "", fmt.Errorf("PackParcels failed: parcel %q does not exist", parcelID)
		}
		var parcel model.Parcel
		if err := json.Unmarshal(content, &parcel); err != nil {
			return "", fmt.Errorf("Ledger integrity error: state at %q is not a parcel document", parcelKey(parcelID))
		}
		if parcel.ShipmentID != shipment.ID {
			return "", fmt.Errorf(
				"PackParcels failed: parcel %q belongs to shipment %q", parcelID, parcel.ShipmentID,
			)
		}
		if parcel.Status != model.ParcelCreated {
			return "", fmt.Errorf(
				"PackParcels failed: parcel %q must be in %s status; current status is %s",
				parcelID, model.ParcelCreated, parcel.Status,
			)
		}
		parcels = append(parcels, parcel)
	}
	if exists, err := stateExists(ctx, unitKey(unitID)); err != nil {
		return "", err
	} else if exists {
		return "", fmt.Errorf("PackParcels failed: unit id %q already exists", unitID)
	}

	timestamp, err := transactionTimestamp(ctx)
	if err != nil {
		return "", err
	}
	unit := model.LogisticsUnit{
		DocType: "unit", ID: unitID, ShipmentID: shipment.ID, UnitType: unitType,
		ParcelIDs: parcelIDs, Status: model.UnitPacked,
		TxID: ctx.GetStub().GetTxID(), CreatedAt: timestamp, UpdatedAt: timestamp,
	}
	if err := putCollab(ctx, unitKey(unitID), shipmentUnitKey(shipment.ID, unitID), unit); err != nil {
		return "", err
	}
	for i := range parcels {
		parcels[i].Status = model.ParcelPacked
		parcels[i].UnitID = unitID
		parcels[i].UpdatedAt = timestamp
		if err := putCollab(ctx, parcelKey(parcels[i].ID), shipmentParcelKey(shipment.ID, parcels[i].ID), parcels[i]); err != nil {
			return "", err
		}
	}
	return marshalCollab(unit)
}

// UnpackParcels opens a logistics unit at its destination hub.
func (c *LogisticsContract) UnpackParcels(
	ctx contractapi.TransactionContextInterface,
	shipmentID, unitID string,
) (string, error) {
	if err := requireMSP(ctx, org2MSP, "UnpackParcels"); err != nil {
		return "", err
	}
	unitID, err := identifier(unitID, "unit id")
	if err != nil {
		return "", err
	}
	unit, err := loadCollab[model.LogisticsUnit](ctx, unitKey(unitID), "unit")
	if err != nil {
		return "", err
	}
	if _, shipment, err := loadShipment(ctx, shipmentID); err != nil {
		return "", err
	} else if unit.ShipmentID != shipment.ID {
		return "", fmt.Errorf(
			"UnpackParcels failed: unit %q belongs to shipment %q", unitID, unit.ShipmentID,
		)
	}
	if unit.Status != model.UnitPacked {
		return "", fmt.Errorf(
			"UnpackParcels failed: unit %q must be in %s status; current status is %s",
			unitID, model.UnitPacked, unit.Status,
		)
	}

	timestamp, err := transactionTimestamp(ctx)
	if err != nil {
		return "", err
	}
	unit.Status = model.UnitUnpacked
	unit.UpdatedAt = timestamp
	if err := putCollab(ctx, unitKey(unitID), shipmentUnitKey(unit.ShipmentID, unit.ID), unit); err != nil {
		return "", err
	}
	for _, parcelID := range unit.ParcelIDs {
		parcel, err := loadCollab[model.Parcel](ctx, parcelKey(parcelID), "parcel")
		if err != nil {
			return "", err
		}
		parcel.Status = model.ParcelUnpacked
		parcel.UpdatedAt = timestamp
		if err := putCollab(ctx, parcelKey(parcelID), shipmentParcelKey(unit.ShipmentID, parcelID), parcel); err != nil {
			return "", err
		}
	}
	return marshalCollab(unit)
}

// InitiateHandover opens a cross-org custody transfer on an in-flight shipment.
// Only the shipper side (Org1MSP) initiates; confirmation is a separate
// transaction reserved to the carrier side (Org2MSP).
func (c *LogisticsContract) InitiateHandover(
	ctx contractapi.TransactionContextInterface,
	handoverID, shipmentID, fromHub, toHub, carrierOrg string,
) (string, error) {
	if err := requireMSP(ctx, org1MSP, "InitiateHandover"); err != nil {
		return "", err
	}
	handoverID, err := identifier(handoverID, "handover id")
	if err != nil {
		return "", err
	}
	_, shipment, err := loadShipment(ctx, shipmentID)
	if err != nil {
		return "", err
	}
	if err := requireStatus(
		shipment, "InitiateHandover",
		model.StatusAccepted, model.StatusPickedUp, model.StatusInTransit, model.StatusException,
	); err != nil {
		return "", err
	}
	if err := requireString(fromHub, "fromHub", 128); err != nil {
		return "", err
	}
	if err := requireString(toHub, "toHub", 128); err != nil {
		return "", err
	}
	if strings.TrimSpace(carrierOrg) != org2MSP {
		return "", fmt.Errorf(
			"InitiateHandover failed: carrierOrg must be %s; got %q", org2MSP, carrierOrg,
		)
	}
	if exists, err := stateExists(ctx, handoverKey(handoverID)); err != nil {
		return "", err
	} else if exists {
		return "", fmt.Errorf("InitiateHandover failed: handover id %q already exists", handoverID)
	}

	timestamp, err := transactionTimestamp(ctx)
	if err != nil {
		return "", err
	}
	mspID, err := currentMSP(ctx)
	if err != nil {
		return "", err
	}
	handover := model.Handover{
		DocType: "handover", HandoverID: handoverID, ShipmentID: shipment.ID,
		FromHub: strings.TrimSpace(fromHub), ToHub: strings.TrimSpace(toHub),
		CarrierOrg: org2MSP, Status: model.HandoverInitiated,
		InitiatorOrg: mspID, CreatedAt: timestamp, InitiatorTxID: ctx.GetStub().GetTxID(),
	}
	if err := putCollab(ctx, handoverKey(handoverID), shipmentHandoverKey(shipment.ID, handoverID), handover); err != nil {
		return "", err
	}
	return marshalCollab(handover)
}

// ConfirmHandover completes a handover from the carrier side. Because
// initiation is restricted to Org1MSP, the initiator can never confirm its own
// handover, and an already-confirmed handover is rejected.
func (c *LogisticsContract) ConfirmHandover(
	ctx contractapi.TransactionContextInterface,
	handoverID string,
) (string, error) {
	if err := requireMSP(ctx, org2MSP, "ConfirmHandover"); err != nil {
		return "", err
	}
	handoverID, err := identifier(handoverID, "handover id")
	if err != nil {
		return "", err
	}
	handover, err := loadCollab[model.Handover](ctx, handoverKey(handoverID), "handover")
	if err != nil {
		return "", err
	}
	if handover.Status != model.HandoverInitiated {
		return "", fmt.Errorf(
			"ConfirmHandover failed: handover %q must be in %s status; current status is %s",
			handoverID, model.HandoverInitiated, handover.Status,
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
	handover.Status = model.HandoverConfirmed
	handover.ConfirmOrg = mspID
	handover.ConfirmedAt = timestamp
	handover.ConfirmTxID = ctx.GetStub().GetTxID()
	if err := putCollab(ctx, handoverKey(handoverID), shipmentHandoverKey(handover.ShipmentID, handover.HandoverID), handover); err != nil {
		return "", err
	}
	return marshalCollab(handover)
}

// RecordNodeEvent appends a free-form tracking event from either organization
// without changing the shipment status. actorOrg is advisory and must match
// the caller's MSP when provided.
func (c *LogisticsContract) RecordNodeEvent(
	ctx contractapi.TransactionContextInterface,
	shipmentID, eventType, hubCode, actorOrg, actorID, remark string,
) (string, error) {
	mspID, err := currentMSP(ctx)
	if err != nil {
		return "", err
	}
	if mspID != org1MSP && mspID != org2MSP {
		return "", fmt.Errorf(
			"RecordNodeEvent is restricted to %s or %s; caller belongs to %s",
			org1MSP, org2MSP, mspID,
		)
	}
	if strings.TrimSpace(actorOrg) != "" && strings.TrimSpace(actorOrg) != mspID {
		return "", fmt.Errorf(
			"RecordNodeEvent failed: actorOrg %q does not match caller MSP %s", actorOrg, mspID,
		)
	}
	if err := requireString(eventType, "eventType", 32); err != nil {
		return "", err
	}
	if err := requireString(hubCode, "hubCode", 64); err != nil {
		return "", err
	}
	if err := requireString(actorID, "actorId", 128); err != nil {
		return "", err
	}
	if err := requireString(remark, "remark", 500); err != nil {
		return "", err
	}
	key, shipment, err := loadShipment(ctx, shipmentID)
	if err != nil {
		return "", err
	}
	if err := requireStatus(
		shipment, "RecordNodeEvent",
		model.StatusAccepted, model.StatusPickedUp, model.StatusInTransit,
		model.StatusException, model.StatusDelivered,
	); err != nil {
		return "", err
	}

	timestamp, err := transactionTimestamp(ctx)
	if err != nil {
		return "", err
	}
	event := model.ShipmentEvent{
		Sequence: len(shipment.Events) + 1, Type: strings.TrimSpace(eventType),
		Location: strings.TrimSpace(hubCode), Description: strings.TrimSpace(remark),
		ActorID: strings.TrimSpace(actorID), ActorName: strings.TrimSpace(actorID),
		MSPID: mspID, TxID: ctx.GetStub().GetTxID(), Timestamp: timestamp,
	}
	appendEvents(&shipment, []model.ShipmentEvent{event}, timestamp)
	return commitMutation(ctx, key, shipment, "RECORD_NODE_EVENT", []model.ShipmentEvent{event}, timestamp)
}

// ReadParcel returns one parcel by id.
func (c *LogisticsContract) ReadParcel(
	ctx contractapi.TransactionContextInterface,
	parcelID string,
) (string, error) {
	parcelID, err := identifier(parcelID, "parcel id")
	if err != nil {
		return "", err
	}
	parcel, err := loadCollab[model.Parcel](ctx, parcelKey(parcelID), "parcel")
	if err != nil {
		return "", err
	}
	return marshalCollab(parcel)
}

// ReadUnit returns one logistics unit by id.
func (c *LogisticsContract) ReadUnit(
	ctx contractapi.TransactionContextInterface,
	unitID string,
) (string, error) {
	unitID, err := identifier(unitID, "unit id")
	if err != nil {
		return "", err
	}
	unit, err := loadCollab[model.LogisticsUnit](ctx, unitKey(unitID), "unit")
	if err != nil {
		return "", err
	}
	return marshalCollab(unit)
}

// ReadHandover returns one handover by id.
func (c *LogisticsContract) ReadHandover(
	ctx contractapi.TransactionContextInterface,
	handoverID string,
) (string, error) {
	handoverID, err := identifier(handoverID, "handover id")
	if err != nil {
		return "", err
	}
	handover, err := loadCollab[model.Handover](ctx, handoverKey(handoverID), "handover")
	if err != nil {
		return "", err
	}
	return marshalCollab(handover)
}

// GetParcels lists the parcels of a shipment.
func (c *LogisticsContract) GetParcels(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
) (string, error) {
	return listShipmentLinks[model.Parcel](ctx, shipmentID, shipmentParcelKeyPrefix, "parcel")
}

// GetUnits lists the logistics units of a shipment.
func (c *LogisticsContract) GetUnits(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
) (string, error) {
	return listShipmentLinks[model.LogisticsUnit](ctx, shipmentID, shipmentUnitKeyPrefix, "unit")
}

// GetHandovers lists the handovers of a shipment.
func (c *LogisticsContract) GetHandovers(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
) (string, error) {
	return listShipmentLinks[model.Handover](ctx, shipmentID, shipmentHandoverKeyPrefix, "handover")
}

func putCollab(
	ctx contractapi.TransactionContextInterface,
	mainKey, linkKey string,
	value any,
) error {
	content, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := ctx.GetStub().PutState(mainKey, content); err != nil {
		return err
	}
	return ctx.GetStub().PutState(linkKey, []byte(mainKey))
}

func loadCollab[T any](
	ctx contractapi.TransactionContextInterface,
	key, label string,
) (T, error) {
	var value T
	content, err := ctx.GetStub().GetState(key)
	if err != nil {
		return value, err
	}
	if len(content) == 0 {
		return value, fmt.Errorf("%s %q does not exist", label, key)
	}
	if err := json.Unmarshal(content, &value); err != nil {
		return value, fmt.Errorf("Ledger integrity error: state at %q is not a %s document", key, label)
	}
	return value, nil
}

func listShipmentLinks[T any](
	ctx contractapi.TransactionContextInterface,
	shipmentID, linkPrefix, label string,
) (string, error) {
	start, end := linkKeyRange(linkPrefix, shipmentID)
	iterator, err := ctx.GetStub().GetStateByRange(start, end)
	if err != nil {
		return "", err
	}
	defer iterator.Close()

	items := []T{}
	for iterator.HasNext() {
		result, err := iterator.Next()
		if err != nil {
			return "", err
		}
		value, err := loadCollab[T](ctx, string(result.Value), label)
		if err != nil {
			return "", fmt.Errorf("Ledger integrity error: %w", err)
		}
		items = append(items, value)
	}
	return marshalCollab(items)
}

func marshalCollab(value any) (string, error) {
	content, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(content), nil
}
