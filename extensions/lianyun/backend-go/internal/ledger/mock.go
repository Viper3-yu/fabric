package ledger

import (
	"fmt"
	"sync"
	"time"

	"lianyun-backend/internal/domain"
)

type Mock struct {
	mu        sync.RWMutex
	shipments map[string]domain.Shipment
	handovers map[string]domain.Handover
}

func NewMock() *Mock {
	events := []domain.TrackingEvent{
		{ID: "evt-001", Type: "CREATED", HubCode: "HZ-WH-01", HubName: "杭州滨江仓", ActorOrg: "Org1MSP", ActorName: "杭州货主", Remark: "创建运单，包含3个包裹", At: "2026-09-01T08:00:00Z", TxID: "0x8b21ce30a1"},
		{ID: "evt-002", Type: "ACCEPTED", HubCode: "HZ-WH-01", HubName: "杭州滨江仓", ActorOrg: "Org2MSP", ActorName: "承运运营员", Remark: "承运方接单", At: "2026-09-01T08:15:00Z", TxID: "0x39ea7ba491"},
		{ID: "evt-003", Type: "HANDOVER_CONFIRMED", HubCode: "HZ-HUB-01", HubName: "杭州分拨中心", ActorOrg: "Org2MSP", ActorName: "杭州分拨员", Remark: "杭州滨江仓交接确认", At: "2026-09-01T10:05:00Z", TxID: "0x42dfa07a28"},
		{ID: "evt-004", Type: "EXCEPTION", HubCode: "WH-HUB-01", HubName: "武汉中转中心", ActorOrg: "Org2MSP", ActorName: "武汉中转员", Remark: "干线车辆临时检修，预计延误6小时32分钟", Severity: "HIGH", EvidenceHash: "4f1bbd...b8a2", At: "2026-09-01T18:20:00Z", TxID: "0xa5f38c917d"},
		{ID: "evt-005", Type: "EXCEPTION_RESOLVED", HubCode: "WH-HUB-01", HubName: "武汉中转中心", ActorOrg: "Org2MSP", ActorName: "武汉中转员", Remark: "已换车发运，异常解除", At: "2026-09-02T00:52:00Z", TxID: "0xcc91af2d20"},
	}
	return &Mock{shipments: map[string]domain.Shipment{
		"YT20260001": {ID: "YT20260001", Origin: "杭州", Destination: "北京", Status: "IN_TRANSIT", OwnerOrg: "Org1MSP", CarrierOrg: "Org2MSP", Parcels: []domain.Parcel{{ID: "P-1001", Status: "PACKED", UnitID: "BOX-001"}, {ID: "P-1002", Status: "PACKED", UnitID: "BOX-001"}, {ID: "P-1003", Status: "PACKED", UnitID: "BOX-001"}}, Events: events},
	}, handovers: make(map[string]domain.Handover)}
}

func (m *Mock) ReadShipment(id string) (domain.Shipment, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.shipments[id]
	if !ok {
		return domain.Shipment{}, fmt.Errorf("运单不存在")
	}
	return s, nil
}
func (m *Mock) QueryTrace(id string) ([]domain.TrackingEvent, error) {
	s, e := m.ReadShipment(id)
	return s.Events, e
}
func (m *Mock) AppendEvent(id string, event domain.TrackingEvent) (domain.TrackingEvent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.shipments[id]
	if !ok {
		return event, fmt.Errorf("运单不存在")
	}
	event.ID = fmt.Sprintf("evt-%d", len(s.Events)+1)
	event.At = time.Now().UTC().Format(time.RFC3339)
	event.TxID = fmt.Sprintf("0xmock%08x", len(s.Events)+1)
	s.Events = append(s.Events, event)
	s.Status = event.Type
	m.shipments[id] = s
	return event, nil
}

func (m *Mock) InitiateHandover(shipmentID, handoverID, fromHub, toHub, carrierOrg string) (domain.Handover, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.shipments[shipmentID]; !ok {
		return domain.Handover{}, fmt.Errorf("运单不存在")
	}
	if _, exists := m.handovers[handoverID]; exists {
		return domain.Handover{}, fmt.Errorf("交接单已存在")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	handover := domain.Handover{DocType: "handover", HandoverID: handoverID, ShipmentID: shipmentID, FromHub: fromHub, ToHub: toHub, CarrierOrg: carrierOrg, Status: "PENDING", InitiatorOrg: "Org1MSP", CreatedAt: now}
	m.handovers[handoverID] = handover
	return handover, nil
}

func (m *Mock) ConfirmHandover(handoverID string) (domain.Handover, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	handover, ok := m.handovers[handoverID]
	if !ok {
		return domain.Handover{}, fmt.Errorf("交接单不存在")
	}
	if handover.Status != "PENDING" {
		return domain.Handover{}, fmt.Errorf("交接单不可重复确认")
	}
	handover.Status = "CONFIRMED"
	handover.ConfirmOrg = "Org2MSP"
	handover.ConfirmedAt = time.Now().UTC().Format(time.RFC3339)
	m.handovers[handoverID] = handover
	return handover, nil
}
