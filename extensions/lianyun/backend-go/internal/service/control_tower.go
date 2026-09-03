package service

import (
	"fmt"
	"lianyun-backend/internal/domain"
	"lianyun-backend/internal/ledger"
	"lianyun-backend/internal/risk"
)

type DataSource interface {
	LoadHubs() ([]domain.Hub, error)
	LoadSegments(string, map[string]domain.Hub) ([]domain.RouteSegment, error)
	LoadGPS(string) ([]domain.MapPoint, error)
	LoadTemperature(string) ([]domain.TemperatureReading, error)
}

type ControlTowerService struct {
	ledger ledger.Client
	data   DataSource
}

func (s *ControlTowerService) InitiateHandover(shipmentID, handoverID, fromHub, toHub, carrierOrg string) (domain.Handover, error) {
	return s.ledger.InitiateHandover(shipmentID, handoverID, fromHub, toHub, carrierOrg)
}

func (s *ControlTowerService) ConfirmHandover(handoverID string) (domain.Handover, error) {
	return s.ledger.ConfirmHandover(handoverID)
}

func NewControlTowerService(l ledger.Client, data ...DataSource) *ControlTowerService {
	var source DataSource
	if len(data) > 0 {
		source = data[0]
	}
	return &ControlTowerService{ledger: l, data: source}
}

func hubs() []domain.Hub {
	return []domain.Hub{
		{Code: "HZ-WH-01", Name: "杭州滨江仓", City: "杭州", Longitude: 120.155070, Latitude: 30.274084, Type: "WAREHOUSE"},
		{Code: "HZ-HUB-01", Name: "杭州分拨中心", City: "杭州", Longitude: 120.174000, Latitude: 30.278000, Type: "HUB"},
		{Code: "WH-HUB-01", Name: "武汉中转中心", City: "武汉", Longitude: 114.305500, Latitude: 30.593100, Type: "HUB"},
		{Code: "BJ-HUB-01", Name: "北京分拨中心", City: "北京", Longitude: 116.407400, Latitude: 39.904200, Type: "HUB"},
		{Code: "BJ-DLV-01", Name: "北京朝阳末端网点", City: "北京", Longitude: 116.486400, Latitude: 39.921900, Type: "DELIVERY"},
	}
}

func (s *ControlTowerService) Get(id string) (domain.ControlTower, error) {
	shipment, err := s.ledger.ReadShipment(id)
	if err != nil {
		return domain.ControlTower{}, err
	}
	allHubs := hubs()
	if s.data != nil {
		if loaded, e := s.data.LoadHubs(); e == nil && len(loaded) > 0 {
			allHubs = loaded
		}
	}
	h := map[string]domain.Hub{}
	for _, x := range allHubs {
		h[x.Code] = x
	}
	segments := []domain.RouteSegment{
		{ID: "SEG-01", Sequence: 1, FromHub: h["HZ-WH-01"], ToHub: h["HZ-HUB-01"], PlannedDeparture: "2026-09-01T08:00:00Z", PlannedArrival: "2026-09-01T10:00:00Z", ActualDeparture: "2026-09-01T08:22:00Z", ActualArrival: "2026-09-01T10:05:00Z", CarrierOrg: "Org2MSP", Status: "NORMAL"},
		{ID: "SEG-02", Sequence: 2, FromHub: h["HZ-HUB-01"], ToHub: h["WH-HUB-01"], PlannedDeparture: "2026-09-01T10:30:00Z", PlannedArrival: "2026-09-01T17:00:00Z", ActualDeparture: "2026-09-01T10:34:00Z", ActualArrival: "2026-09-01T18:20:00Z", CarrierOrg: "Org2MSP", Status: "EXCEPTION"},
		{ID: "SEG-03", Sequence: 3, FromHub: h["WH-HUB-01"], ToHub: h["BJ-HUB-01"], PlannedDeparture: "2026-09-01T17:30:00Z", PlannedArrival: "2026-09-02T08:00:00Z", ActualDeparture: "2026-09-02T00:52:00Z", CarrierOrg: "Org2MSP", Status: "IN_TRANSIT"},
		{ID: "SEG-04", Sequence: 4, FromHub: h["BJ-HUB-01"], ToHub: h["BJ-DLV-01"], PlannedDeparture: "2026-09-02T08:30:00Z", PlannedArrival: "2026-09-02T11:00:00Z", CarrierOrg: "Org2MSP", Status: "PLANNED"},
	}
	gps := []domain.MapPoint{{Longitude: 120.155070, Latitude: 30.274084, At: "2026-09-01T08:20:00Z", Speed: 0}, {Longitude: 120.174000, Latitude: 30.278000, At: "2026-09-01T10:05:00Z", Speed: 42}, {Longitude: 114.600000, Latitude: 30.700000, At: "2026-09-01T15:00:00Z", Speed: 76}, {Longitude: 114.305500, Latitude: 30.593100, At: "2026-09-01T18:20:00Z", Speed: 0}, {Longitude: 114.800000, Latitude: 31.000000, At: "2026-09-02T01:20:00Z", Speed: 80}}
	temp := []domain.TemperatureReading{{At: "2026-09-01T10:30:00Z", Value: 8.1, Humidity: 52}, {At: "2026-09-01T13:00:00Z", Value: 8.7, Humidity: 54}, {At: "2026-09-01T16:00:00Z", Value: 10.8, Humidity: 61}, {At: "2026-09-01T18:20:00Z", Value: 9.2, Humidity: 58}, {At: "2026-09-02T01:20:00Z", Value: 8.6, Humidity: 54}}
	if s.data != nil {
		if loaded, e := s.data.LoadSegments(id, h); e == nil && len(loaded) > 0 {
			segments = loaded
		}
		if loaded, e := s.data.LoadGPS(id); e == nil && len(loaded) > 0 {
			gps = loaded
		}
		if loaded, e := s.data.LoadTemperature(id); e == nil && len(loaded) > 0 {
			temp = loaded
		}
	}
	if origin, ok := h[shipment.Origin]; ok {
		shipment.Origin = origin.City
	}
	if destination, ok := h[shipment.Destination]; ok {
		shipment.Destination = destination.City
	}
	for i := range shipment.Events {
		if hub, ok := h[shipment.Events[i].HubCode]; ok {
			shipment.Events[i].HubName = hub.Name
		}
	}
	tower := domain.ControlTower{Shipment: shipment, Hubs: allHubs, Segments: segments, GPS: gps, Temperature: temp}
	tower.TemperatureRange.Min = 2
	tower.TemperatureRange.Max = 10
	tower.Risks = risk.Analyze(segments, shipment.Events, gps)
	return tower, nil
}

func (s *ControlTowerService) Append(id string, event domain.TrackingEvent) (domain.TrackingEvent, error) {
	if event.Type == "" {
		return event, fmt.Errorf("事件类型不能为空")
	}
	return s.ledger.AppendEvent(id, event)
}
