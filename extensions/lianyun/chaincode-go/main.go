package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type SmartContract struct {
	contractapi.Contract
}

type Shipment struct {
	DocType        string   `json:"docType"`
	ShipmentID     string   `json:"shipmentId"`
	OriginHub      string   `json:"originHub"`
	DestinationHub string   `json:"destinationHub"`
	Status         string   `json:"status"`
	OwnerOrg       string   `json:"ownerOrg"`
	CarrierOrg     string   `json:"carrierOrg"`
	ParcelIDs      []string `json:"parcelIds"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

type Parcel struct {
	DocType    string `json:"docType"`
	ParcelID   string `json:"parcelId"`
	ShipmentID string `json:"shipmentId"`
	Status     string `json:"status"`
	UnitID     string `json:"unitId,omitempty"`
	UpdatedAt  string `json:"updatedAt"`
}

type LogisticsUnit struct {
	DocType    string   `json:"docType"`
	UnitID     string   `json:"unitId"`
	ShipmentID string   `json:"shipmentId"`
	UnitType   string   `json:"unitType"`
	ParcelIDs  []string `json:"parcelIds"`
	Status     string   `json:"status"`
	UpdatedAt  string   `json:"updatedAt"`
}

type TrackingEvent struct {
	EventID      string `json:"eventId"`
	ShipmentID   string `json:"shipmentId"`
	EventType    string `json:"eventType"`
	HubCode      string `json:"hubCode"`
	ActorOrg     string `json:"actorOrg"`
	ActorID      string `json:"actorId"`
	Remark       string `json:"remark"`
	RelatedID    string `json:"relatedId"`
	Severity     string `json:"severity"`
	EvidenceHash string `json:"evidenceHash"`
	Timestamp    string `json:"timestamp"`
	TxID         string `json:"txId"`
}

type Handover struct {
	DocType      string `json:"docType"`
	HandoverID   string `json:"handoverId"`
	ShipmentID   string `json:"shipmentId"`
	FromHub      string `json:"fromHub"`
	ToHub        string `json:"toHub"`
	CarrierOrg   string `json:"carrierOrg"`
	Status       string `json:"status"`
	InitiatorOrg string `json:"initiatorOrg"`
	ConfirmOrg   string `json:"confirmOrg"`
	CreatedAt    string `json:"createdAt"`
	ConfirmedAt  string `json:"confirmedAt"`
}

type Evidence struct {
	DocType      string `json:"docType"`
	EvidenceID   string `json:"evidenceId"`
	ShipmentID   string `json:"shipmentId"`
	EvidenceType string `json:"evidenceType"`
	SHA256       string `json:"sha256"`
	SubmittedBy  string `json:"submittedBy"`
	Timestamp    string `json:"timestamp"`
	TxID         string `json:"txId"`
}

func now(ctx contractapi.TransactionContextInterface) (string, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return "", err
	}
	return time.Unix(ts.Seconds, int64(ts.Nanos)).UTC().Format(time.RFC3339), nil
}

func readJSON[T any](ctx contractapi.TransactionContextInterface, key string, out *T) error {
	raw, err := ctx.GetStub().GetState(key)
	if err != nil {
		return err
	}
	if raw == nil {
		return fmt.Errorf("%s 不存在", key)
	}
	return json.Unmarshal(raw, out)
}

func putJSON(ctx contractapi.TransactionContextInterface, key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(key, raw)
}

// requireMSP prevents the API layer from forging another organisation's business event.
func requireMSP(ctx contractapi.TransactionContextInterface, expected string) error {
	actual, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return err
	}
	if actual != expected {
		return fmt.Errorf("当前组织 %s 无权以 %s 身份提交交易", actual, expected)
	}
	return nil
}

func (s *SmartContract) appendEvent(ctx contractapi.TransactionContextInterface, e TrackingEvent) error {
	key, err := ctx.GetStub().CreateCompositeKey("event", []string{e.ShipmentID, e.EventID})
	if err != nil {
		return err
	}
	return putJSON(ctx, key, e)
}

// InitLedger creates one deterministic demonstration shipment after deployment.
// It is idempotent and restricted to Org1MSP so repeated setup is safe.
func (s *SmartContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	if raw, err := ctx.GetStub().GetState("shipment:YT20260001"); err != nil {
		return err
	} else if raw != nil {
		return nil
	}
	t, err := now(ctx)
	if err != nil {
		return err
	}
	shipment := &Shipment{"shipment", "YT20260001", "HZ-WH-01", "BJ-DLV-01", "IN_TRANSIT", "Org1MSP", "Org2MSP", []string{"P-1001", "P-1002", "P-1003"}, t, t}
	if err := putJSON(ctx, "shipment:"+shipment.ShipmentID, shipment); err != nil {
		return err
	}
	for _, parcelID := range shipment.ParcelIDs {
		parcel := &Parcel{"parcel", parcelID, shipment.ShipmentID, "PACKED", "BOX-001", t}
		if err := putJSON(ctx, "parcel:"+parcelID, parcel); err != nil {
			return err
		}
	}
	unit := &LogisticsUnit{"unit", "BOX-001", shipment.ShipmentID, "BOX", shipment.ParcelIDs, "ACTIVE", t}
	if err := putJSON(ctx, "unit:"+unit.UnitID, unit); err != nil {
		return err
	}
	txID := ctx.GetStub().GetTxID()
	return s.appendEvent(ctx, TrackingEvent{txID + ":init", shipment.ShipmentID, "IN_TRANSIT", "WH-HUB-01", "Org1MSP", "setup", "初始化演示运单", "BOX-001", "", "", t, txID})
}

func (s *SmartContract) CreateShipment(ctx contractapi.TransactionContextInterface, shipmentID, originHub, destinationHub, ownerOrg, actorID string) (*Shipment, error) {
	if err := requireMSP(ctx, ownerOrg); err != nil {
		return nil, err
	}
	key := "shipment:" + shipmentID
	exists, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if exists != nil {
		return nil, fmt.Errorf("运单已存在")
	}
	t, err := now(ctx)
	if err != nil {
		return nil, err
	}
	shipment := &Shipment{"shipment", shipmentID, originHub, destinationHub, "CREATED", ownerOrg, "", []string{}, t, t}
	if err := putJSON(ctx, key, shipment); err != nil {
		return nil, err
	}
	event := TrackingEvent{ctx.GetStub().GetTxID(), shipmentID, "CREATED", originHub, ownerOrg, actorID, "创建运单", "", "", "", t, ctx.GetStub().GetTxID()}
	return shipment, s.appendEvent(ctx, event)
}

func (s *SmartContract) AddParcel(ctx contractapi.TransactionContextInterface, shipmentID, parcelID, actorID string) (*Parcel, error) {
	var shipment Shipment
	if err := readJSON(ctx, "shipment:"+shipmentID, &shipment); err != nil {
		return nil, err
	}
	if err := requireMSP(ctx, shipment.OwnerOrg); err != nil {
		return nil, err
	}
	if raw, _ := ctx.GetStub().GetState("parcel:" + parcelID); raw != nil {
		return nil, fmt.Errorf("包裹已存在")
	}
	t, err := now(ctx)
	if err != nil {
		return nil, err
	}
	parcel := &Parcel{"parcel", parcelID, shipmentID, "CREATED", "", t}
	shipment.ParcelIDs = append(shipment.ParcelIDs, parcelID)
	shipment.UpdatedAt = t
	if err := putJSON(ctx, "parcel:"+parcelID, parcel); err != nil {
		return nil, err
	}
	if err := putJSON(ctx, "shipment:"+shipmentID, &shipment); err != nil {
		return nil, err
	}
	return parcel, s.appendEvent(ctx, TrackingEvent{ctx.GetStub().GetTxID(), shipmentID, "PARCEL_ADDED", shipment.OriginHub, shipment.OwnerOrg, actorID, "添加包裹 " + parcelID, parcelID, "", "", t, ctx.GetStub().GetTxID()})
}

func (s *SmartContract) AcceptShipment(ctx contractapi.TransactionContextInterface, shipmentID, carrierOrg, actorID string) (*Shipment, error) {
	if err := requireMSP(ctx, carrierOrg); err != nil {
		return nil, err
	}
	var shipment Shipment
	if err := readJSON(ctx, "shipment:"+shipmentID, &shipment); err != nil {
		return nil, err
	}
	if shipment.Status != "CREATED" {
		return nil, fmt.Errorf("当前状态不允许接单")
	}
	t, err := now(ctx)
	if err != nil {
		return nil, err
	}
	shipment.CarrierOrg, shipment.Status, shipment.UpdatedAt = carrierOrg, "ACCEPTED", t
	if err := putJSON(ctx, "shipment:"+shipmentID, &shipment); err != nil {
		return nil, err
	}
	return &shipment, s.appendEvent(ctx, TrackingEvent{ctx.GetStub().GetTxID(), shipmentID, "ACCEPTED", shipment.OriginHub, carrierOrg, actorID, "承运方接单", "", "", "", t, ctx.GetStub().GetTxID()})
}

func (s *SmartContract) PackParcels(ctx contractapi.TransactionContextInterface, shipmentID, unitID, unitType, parcelJSON, actorID string) (*LogisticsUnit, error) {
	var shipment Shipment
	if err := readJSON(ctx, "shipment:"+shipmentID, &shipment); err != nil {
		return nil, err
	}
	if err := requireMSP(ctx, shipment.CarrierOrg); err != nil {
		return nil, err
	}
	var parcels []string
	if err := json.Unmarshal([]byte(parcelJSON), &parcels); err != nil || len(parcels) == 0 {
		return nil, fmt.Errorf("包裹列表格式错误")
	}
	if raw, _ := ctx.GetStub().GetState("unit:" + unitID); raw != nil {
		return nil, fmt.Errorf("物流单元已存在")
	}
	t, err := now(ctx)
	if err != nil {
		return nil, err
	}
	for _, id := range parcels {
		var parcel Parcel
		if err := readJSON(ctx, "parcel:"+id, &parcel); err != nil {
			return nil, err
		}
		if parcel.ShipmentID != shipmentID || parcel.UnitID != "" {
			return nil, fmt.Errorf("包裹 %s 不能装箱", id)
		}
		parcel.UnitID, parcel.Status, parcel.UpdatedAt = unitID, "PACKED", t
		if err := putJSON(ctx, "parcel:"+id, &parcel); err != nil {
			return nil, err
		}
	}
	unit := &LogisticsUnit{"unit", unitID, shipmentID, unitType, parcels, "ACTIVE", t}
	if err := putJSON(ctx, "unit:"+unitID, unit); err != nil {
		return nil, err
	}
	return unit, s.appendEvent(ctx, TrackingEvent{ctx.GetStub().GetTxID(), shipmentID, "PACKED", "", "", actorID, "包裹装入物流单元", unitID, "", "", t, ctx.GetStub().GetTxID()})
}

func (s *SmartContract) UnpackParcels(ctx contractapi.TransactionContextInterface, unitID, actorID string) (*LogisticsUnit, error) {
	var unit LogisticsUnit
	if err := readJSON(ctx, "unit:"+unitID, &unit); err != nil {
		return nil, err
	}
	var shipment Shipment
	if err := readJSON(ctx, "shipment:"+unit.ShipmentID, &shipment); err != nil {
		return nil, err
	}
	if err := requireMSP(ctx, shipment.CarrierOrg); err != nil {
		return nil, err
	}
	if unit.Status != "ACTIVE" {
		return nil, fmt.Errorf("物流单元不可拆分")
	}
	t, err := now(ctx)
	if err != nil {
		return nil, err
	}
	for _, id := range unit.ParcelIDs {
		var parcel Parcel
		if err := readJSON(ctx, "parcel:"+id, &parcel); err != nil {
			return nil, err
		}
		parcel.UnitID, parcel.Status, parcel.UpdatedAt = "", "UNPACKED", t
		if err := putJSON(ctx, "parcel:"+id, &parcel); err != nil {
			return nil, err
		}
	}
	unit.Status, unit.UpdatedAt = "UNPACKED", t
	if err := putJSON(ctx, "unit:"+unitID, &unit); err != nil {
		return nil, err
	}
	return &unit, s.appendEvent(ctx, TrackingEvent{ctx.GetStub().GetTxID(), unit.ShipmentID, "UNPACKED", "", "", actorID, "物流单元拆分", unitID, "", "", t, ctx.GetStub().GetTxID()})
}

func (s *SmartContract) InitiateHandover(ctx contractapi.TransactionContextInterface, handoverID, shipmentID, fromHub, toHub, carrierOrg, actorOrg string) (*Handover, error) {
	if err := requireMSP(ctx, actorOrg); err != nil {
		return nil, err
	}
	if raw, _ := ctx.GetStub().GetState("handover:" + handoverID); raw != nil {
		return nil, fmt.Errorf("交接单已存在")
	}
	t, err := now(ctx)
	if err != nil {
		return nil, err
	}
	h := &Handover{"handover", handoverID, shipmentID, fromHub, toHub, carrierOrg, "PENDING", actorOrg, "", t, ""}
	if err := putJSON(ctx, "handover:"+handoverID, h); err != nil {
		return nil, err
	}
	return h, s.appendEvent(ctx, TrackingEvent{ctx.GetStub().GetTxID(), shipmentID, "HANDOVER_INITIATED", fromHub, actorOrg, actorOrg, "发起交接", handoverID, "", "", t, ctx.GetStub().GetTxID()})
}

func (s *SmartContract) ConfirmHandover(ctx contractapi.TransactionContextInterface, handoverID, actorOrg string) (*Handover, error) {
	if err := requireMSP(ctx, actorOrg); err != nil {
		return nil, err
	}
	var h Handover
	if err := readJSON(ctx, "handover:"+handoverID, &h); err != nil {
		return nil, err
	}
	if h.Status != "PENDING" || actorOrg == h.InitiatorOrg {
		return nil, fmt.Errorf("交接确认不合法")
	}
	t, err := now(ctx)
	if err != nil {
		return nil, err
	}
	h.Status, h.ConfirmOrg, h.ConfirmedAt = "CONFIRMED", actorOrg, t
	if err := putJSON(ctx, "handover:"+handoverID, &h); err != nil {
		return nil, err
	}
	return &h, s.appendEvent(ctx, TrackingEvent{ctx.GetStub().GetTxID(), h.ShipmentID, "HANDOVER_CONFIRMED", h.ToHub, actorOrg, actorOrg, "确认接收", h.HandoverID, "", "", t, ctx.GetStub().GetTxID()})
}

func (s *SmartContract) RecordNodeEvent(ctx contractapi.TransactionContextInterface, shipmentID, eventType, hubCode, actorOrg, actorID, remark string) (*Shipment, error) {
	if err := requireMSP(ctx, actorOrg); err != nil {
		return nil, err
	}
	var shipment Shipment
	if err := readJSON(ctx, "shipment:"+shipmentID, &shipment); err != nil {
		return nil, err
	}
	if shipment.Status == "DELIVERED" {
		return nil, fmt.Errorf("已签收运单不能继续更新")
	}
	t, err := now(ctx)
	if err != nil {
		return nil, err
	}
	shipment.Status, shipment.UpdatedAt = eventType, t
	if err := putJSON(ctx, "shipment:"+shipmentID, &shipment); err != nil {
		return nil, err
	}
	event := TrackingEvent{ctx.GetStub().GetTxID(), shipmentID, eventType, hubCode, actorOrg, actorID, remark, "", "", "", t, ctx.GetStub().GetTxID()}
	return &shipment, s.appendEvent(ctx, event)
}

func (s *SmartContract) ReportException(ctx contractapi.TransactionContextInterface, shipmentID, hubCode, actorOrg, actorID, severity, remark, evidenceHash string) (*Shipment, error) {
	if err := requireMSP(ctx, actorOrg); err != nil {
		return nil, err
	}
	var shipment Shipment
	if err := readJSON(ctx, "shipment:"+shipmentID, &shipment); err != nil {
		return nil, err
	}
	t, err := now(ctx)
	if err != nil {
		return nil, err
	}
	shipment.Status, shipment.UpdatedAt = "EXCEPTION", t
	if err := putJSON(ctx, "shipment:"+shipmentID, &shipment); err != nil {
		return nil, err
	}
	event := TrackingEvent{ctx.GetStub().GetTxID(), shipmentID, "EXCEPTION", hubCode, actorOrg, actorID, remark, "", severity, evidenceHash, t, ctx.GetStub().GetTxID()}
	return &shipment, s.appendEvent(ctx, event)
}

func (s *SmartContract) AnchorEvidence(ctx contractapi.TransactionContextInterface, evidenceID, shipmentID, evidenceType, sha256, actorOrg string) (*Evidence, error) {
	if err := requireMSP(ctx, actorOrg); err != nil {
		return nil, err
	}
	if raw, _ := ctx.GetStub().GetState("evidence:" + evidenceID); raw != nil {
		return nil, fmt.Errorf("凭证已存在")
	}
	t, err := now(ctx)
	if err != nil {
		return nil, err
	}
	e := &Evidence{"evidence", evidenceID, shipmentID, evidenceType, sha256, actorOrg, t, ctx.GetStub().GetTxID()}
	if err := putJSON(ctx, "evidence:"+evidenceID, e); err != nil {
		return nil, err
	}
	return e, s.appendEvent(ctx, TrackingEvent{ctx.GetStub().GetTxID(), shipmentID, "EVIDENCE_ANCHORED", "", actorOrg, actorOrg, "凭证哈希上链", evidenceID, "", sha256, t, ctx.GetStub().GetTxID()})
}

func (s *SmartContract) ReadShipment(ctx contractapi.TransactionContextInterface, shipmentID string) (*Shipment, error) {
	var shipment Shipment
	if err := readJSON(ctx, "shipment:"+shipmentID, &shipment); err != nil {
		return nil, err
	}
	return &shipment, nil
}

func (s *SmartContract) QueryTrace(ctx contractapi.TransactionContextInterface, shipmentID string) ([]*TrackingEvent, error) {
	it, err := ctx.GetStub().GetStateByPartialCompositeKey("event", []string{shipmentID})
	if err != nil {
		return nil, err
	}
	defer it.Close()
	var events []*TrackingEvent
	for it.HasNext() {
		item, err := it.Next()
		if err != nil {
			return nil, err
		}
		var e TrackingEvent
		if err := json.Unmarshal(item.Value, &e); err != nil {
			return nil, err
		}
		events = append(events, &e)
	}
	return events, nil
}

func main() {
	cc, err := contractapi.NewChaincode(&SmartContract{})
	if err != nil {
		panic(err)
	}
	if err := cc.Start(); err != nil {
		panic(err)
	}
}
