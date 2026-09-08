package main

import (
	"encoding/json"
	"testing"

	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
)

func setupCollabShipment(t *testing.T, h *contractHarness, shipmentID, tracking string) model.Shipment {
	t.Helper()
	payload, err := h.invoke("Org1MSP", "tx-create-"+shipmentID, nil, "CreateShipment", jsonText(createInputMap(shipmentID, tracking)))
	if err != nil {
		t.Fatalf("create shipment: %v", err)
	}
	shipment := decodeShipmentTest(t, payload)
	_, err = h.invoke(
		"Org2MSP", "tx-accept-"+shipmentID, nil, "AcceptShipment", shipment.ID,
		jsonText(map[string]any{
			"carrierId": "carrier-001", "carrierName": "迅达物流",
			"actorId": "carrier-001", "actorName": "迅达物流",
		}),
	)
	if err != nil {
		t.Fatalf("accept shipment: %v", err)
	}
	shipment.Status = model.StatusAccepted
	return shipment
}

func decodeParcelTest(t *testing.T, payload []byte) model.Parcel {
	t.Helper()
	var parcel model.Parcel
	if err := json.Unmarshal(payload, &parcel); err != nil {
		t.Fatalf("decode parcel: %v", err)
	}
	return parcel
}

func decodeUnitTest(t *testing.T, payload []byte) model.LogisticsUnit {
	t.Helper()
	var unit model.LogisticsUnit
	if err := json.Unmarshal(payload, &unit); err != nil {
		t.Fatalf("decode unit: %v", err)
	}
	return unit
}

func decodeHandoverTest(t *testing.T, payload []byte) model.Handover {
	t.Helper()
	var handover model.Handover
	if err := json.Unmarshal(payload, &handover); err != nil {
		t.Fatalf("decode handover: %v", err)
	}
	return handover
}

func decodeParcelList(t *testing.T, payload []byte) []model.Parcel {
	t.Helper()
	var parcels []model.Parcel
	if err := json.Unmarshal(payload, &parcels); err != nil {
		t.Fatalf("decode parcel list: %v", err)
	}
	return parcels
}

func TestCollaborationParcelUnitAndHandover(t *testing.T) {
	harness := newHarness(t)
	shipment := setupCollabShipment(t, harness, "shipment-001", "JX202607200001")

	parcel, err := harness.invoke(
		"Org1MSP", "tx-parcel-1", nil,
		"AddParcel", shipment.ID, "P-1001", "医药冷链箱",
	)
	if err != nil {
		t.Fatalf("add parcel: %v", err)
	}
	if got := decodeParcelTest(t, parcel); got.Status != model.ParcelCreated {
		t.Fatalf("unexpected parcel status: %#v", got)
	}
	if _, err := harness.invoke(
		"Org1MSP", "tx-parcel-2", nil, "AddParcel", shipment.ID, "P-1002", "",
	); err != nil {
		t.Fatalf("add second parcel: %v", err)
	}
	if _, err := harness.invoke(
		"Org2MSP", "tx-parcel-denied", nil, "AddParcel", shipment.ID, "P-2001", "",
	); err == nil {
		t.Fatalf("carrier AddParcel was not rejected")
	}
	if _, err := harness.invoke(
		"Org1MSP", "tx-parcel-missing", nil, "AddParcel", "shipment-404", "P-3001", "",
	); err == nil {
		t.Fatalf("AddParcel on unknown shipment was not rejected")
	}

	unit, err := harness.invoke(
		"Org1MSP", "tx-pack", nil,
		"PackParcels", shipment.ID, "UNIT-001", "冷藏托盘", `["P-1001","P-1002"]`,
	)
	if err != nil {
		t.Fatalf("pack parcels: %v", err)
	}
	packed := decodeUnitTest(t, unit)
	if packed.Status != model.UnitPacked || len(packed.ParcelIDs) != 2 {
		t.Fatalf("unexpected packed unit: %#v", packed)
	}
	if _, err := harness.invoke(
		"Org1MSP", "tx-pack-again", nil,
		"PackParcels", shipment.ID, "UNIT-002", "冷藏托盘", `["P-1001"]`,
	); err == nil {
		t.Fatalf("repacking a packed parcel was not rejected")
	}
	if _, err := harness.invoke(
		"Org1MSP", "tx-pack-empty", nil, "PackParcels", shipment.ID, "UNIT-003", "冷藏托盘", `[]`,
	); err == nil {
		t.Fatalf("packing an empty parcel list was not rejected")
	}

	handover, err := harness.invoke(
		"Org1MSP", "tx-handover-1", nil,
		"InitiateHandover", "HO-001", shipment.ID, "HZ-WH-01", "HZ-HUB-01", "Org2MSP",
	)
	if err != nil {
		t.Fatalf("initiate handover: %v", err)
	}
	opened := decodeHandoverTest(t, handover)
	if opened.Status != model.HandoverInitiated || opened.InitiatorOrg != "Org1MSP" {
		t.Fatalf("unexpected handover: %#v", opened)
	}
	if _, err := harness.invoke(
		"Org1MSP", "tx-handover-badcarrier", nil,
		"InitiateHandover", "HO-BAD", shipment.ID, "HZ-WH-01", "HZ-HUB-01", "Org3MSP",
	); err == nil {
		t.Fatalf("handover with unknown carrierOrg was not rejected")
	}
	if _, err := harness.invoke(
		"Org2MSP", "tx-handover-denied", nil,
		"InitiateHandover", "HO-002", shipment.ID, "HZ-WH-01", "HZ-HUB-01", "Org2MSP",
	); err == nil {
		t.Fatalf("carrier InitiateHandover was not rejected")
	}

	confirmed, err := harness.invoke(
		"Org2MSP", "tx-confirm", nil, "ConfirmHandover", "HO-001",
	)
	if err != nil {
		t.Fatalf("confirm handover: %v", err)
	}
	done := decodeHandoverTest(t, confirmed)
	if done.Status != model.HandoverConfirmed || done.ConfirmOrg != "Org2MSP" {
		t.Fatalf("unexpected confirmed handover: %#v", done)
	}
	if _, err := harness.invoke(
		"Org2MSP", "tx-confirm-twice", nil, "ConfirmHandover", "HO-001",
	); err == nil {
		t.Fatalf("double confirm was not rejected")
	}

	unpacked, err := harness.invoke(
		"Org2MSP", "tx-unpack", nil, "UnpackParcels", shipment.ID, "UNIT-001",
	)
	if err != nil {
		t.Fatalf("unpack parcels: %v", err)
	}
	if got := decodeUnitTest(t, unpacked); got.Status != model.UnitUnpacked {
		t.Fatalf("unexpected unpacked unit: %#v", got)
	}
	if _, err := harness.invoke(
		"Org1MSP", "tx-unpack-denied", nil, "UnpackParcels", shipment.ID, "UNIT-001",
	); err == nil {
		t.Fatalf("shipper UnpackParcels was not rejected")
	}

	parcels, err := harness.invoke("Org1MSP", "tx-parcels", nil, "GetParcels", shipment.ID)
	if err != nil {
		t.Fatalf("get parcels: %v", err)
	}
	list := decodeParcelList(t, parcels)
	if len(list) != 2 {
		t.Fatalf("expected 2 parcels, got %d", len(list))
	}
	for _, item := range list {
		if item.Status != model.ParcelUnpacked || item.UnitID != "UNIT-001" {
			t.Fatalf("unexpected parcel state: %#v", item)
		}
	}
}

func TestRecordNodeEventAppendsWithoutTransition(t *testing.T) {
	harness := newHarness(t)
	shipment := setupCollabShipment(t, harness, "shipment-001", "JX202607200001")

	raw, err := harness.invoke("Org1MSP", "tx-read", nil, "ReadShipment", shipment.ID)
	if err != nil {
		t.Fatalf("read shipment: %v", err)
	}
	before := decodeShipmentTest(t, raw)
	payload, err := harness.invoke(
		"Org2MSP", "tx-node-1", nil,
		"RecordNodeEvent", shipment.ID, "GPS_UPDATE", "WH-HUB-01", "Org2MSP", "沪A12345", "车辆到达武汉中转中心",
	)
	if err != nil {
		t.Fatalf("record node event: %v", err)
	}
	after := decodeShipmentTest(t, payload)
	if len(after.Events) != len(before.Events)+1 {
		t.Fatalf("expected %d events, got %d", len(before.Events)+1, len(after.Events))
	}
	last := after.Events[len(after.Events)-1]
	if last.Type != "GPS_UPDATE" || last.MSPID != "Org2MSP" || last.Location != "WH-HUB-01" {
		t.Fatalf("unexpected node event: %#v", last)
	}
	if after.Status != model.StatusAccepted {
		t.Fatalf("RecordNodeEvent must not change status, got %s", after.Status)
	}
	if _, err := harness.invoke(
		"Org2MSP", "tx-node-spoof", nil,
		"RecordNodeEvent", shipment.ID, "GPS_UPDATE", "WH-HUB-01", "Org1MSP", "沪A12345", "伪造组织",
	); err == nil {
		t.Fatalf("spoofed actorOrg was not rejected")
	}

	fresh := newHarness(t)
	created, err := fresh.invoke(
		"Org1MSP", "tx-create", nil, "CreateShipment", createPayload(),
	)
	if err != nil {
		t.Fatalf("create shipment: %v", err)
	}
	pending := decodeShipmentTest(t, created)
	if _, err := fresh.invoke(
		"Org2MSP", "tx-node-pending", nil,
		"RecordNodeEvent", pending.ID, "GPS_UPDATE", "HZ-WH-01", "Org2MSP", "沪A12345", "尚未接单",
	); err == nil {
		t.Fatalf("node event on CREATED shipment was not rejected")
	}
}
