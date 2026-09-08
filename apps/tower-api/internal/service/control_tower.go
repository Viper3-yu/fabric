package service

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"tower-api/internal/domain"
	"tower-api/internal/ledger"
	"tower-api/internal/risk"
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

// cityCoords covers the origin/destination cities used by the seed scenarios
// so the fallback route can be derived from the real shipment endpoints.
var cityCoords = map[string][2]float64{
	"上海": {121.4737, 31.2304}, "北京": {116.4074, 39.9042},
	"广州": {113.2644, 23.1291}, "武汉": {114.3055, 30.5928},
	"成都": {104.0665, 30.5723}, "西安": {108.9402, 34.3416},
	"杭州": {120.1551, 30.2741}, "南京": {118.7969, 32.0603},
	"深圳": {114.0579, 22.5431}, "长沙": {112.9388, 28.2282},
	"重庆": {106.5516, 29.5630}, "贵阳": {106.6302, 26.6477},
	"郑州": {113.6254, 34.7466}, "合肥": {117.2272, 31.8206},
	"天津": {117.1901, 39.1256}, "石家庄": {114.5149, 38.0428},
	"青岛": {120.3826, 36.0671}, "沈阳": {123.4315, 41.8057},
	"济南": {117.1205, 36.6519}, "苏州": {120.5853, 31.2989},
}

// normalizeCity strips the 市 suffix so "杭州市", "杭州" and ledger addresses
// resolve to the same coordinate entry.
func normalizeCity(city string) string {
	return strings.TrimSuffix(strings.TrimSpace(city), "市")
}

// deriveRoute builds a schematic route from the shipment's real endpoints:
// origin hub -> midline transit -> destination hub. Timestamps come from the
// on-chain events, so the timeline always matches the ledger. Coordinates are
// synthesized (no GPS devices are attached), which is why the response stays
// labeled dataSource "demo".
func deriveRoute(shipment domain.Shipment) ([]domain.Hub, []domain.RouteSegment, []domain.MapPoint) {
	origin, okOrigin := cityCoords[normalizeCity(shipment.Origin)]
	destination, okDest := cityCoords[normalizeCity(shipment.Destination)]
	if !okOrigin || !okDest {
		return nil, nil, nil
	}
	mid := [2]float64{(origin[0] + destination[0]) / 2, (origin[1] + destination[1]) / 2}
	hubs := []domain.Hub{
		{Code: "ORIGIN", Name: normalizeCity(shipment.Origin) + "发货仓", City: normalizeCity(shipment.Origin), Longitude: origin[0], Latitude: origin[1], Type: "WAREHOUSE"},
		{Code: "TRANSIT", Name: "干线中转中心", City: "干线途中", Longitude: mid[0], Latitude: mid[1], Type: "HUB"},
		{Code: "DEST", Name: normalizeCity(shipment.Destination) + "收货仓", City: normalizeCity(shipment.Destination), Longitude: destination[0], Latitude: destination[1], Type: "DELIVERY"},
	}

	start, end := routeTimeline(shipment.Events)
	planned1End := start.Add(4 * time.Hour)
	planned2Start := start.Add(5 * time.Hour)
	planned2End := start.Add(10 * time.Hour)

	seg1Status, seg2Status := "PLANNED", "PLANNED"
	var seg1Arrive, seg2Depart time.Time
	var seg1Depart time.Time
	switch shipment.Status {
	case "PICKED_UP":
		seg1Status, seg1Depart = "IN_TRANSIT", start.Add(time.Hour)
	case "IN_TRANSIT":
		seg1Status, seg1Arrive = "NORMAL", planned1End
		seg2Status, seg2Depart = "IN_TRANSIT", planned2Start
	case "EXCEPTION":
		seg1Status, seg1Arrive = "NORMAL", planned1End
		seg2Status, seg2Depart = "EXCEPTION", planned2Start
	case "DELIVERED", "RECEIVED":
		seg1Status, seg1Arrive = "NORMAL", planned1End
		seg2Status, seg2Depart = "NORMAL", planned2Start
	}

	segments := []domain.RouteSegment{
		{ID: "SEG-01", Sequence: 1, FromHub: hubs[0], ToHub: hubs[1],
			PlannedDeparture: iso(start), PlannedArrival: iso(planned1End),
			ActualDeparture: isoOrEmpty(seg1Depart), ActualArrival: isoOrEmpty(seg1Arrive),
			CarrierOrg: "Org2MSP", Status: seg1Status,
			Polyline: []domain.MapPoint{{Longitude: origin[0], Latitude: origin[1]}, {Longitude: mid[0], Latitude: mid[1]}}},
		{ID: "SEG-02", Sequence: 2, FromHub: hubs[1], ToHub: hubs[2],
			PlannedDeparture: iso(planned2Start), PlannedArrival: iso(planned2End),
			ActualDeparture: isoOrEmpty(seg2Depart), ActualArrival: isoOrEmpty(arrivedTime(end, seg2Status)),
			CarrierOrg: "Org2MSP", Status: seg2Status,
			Polyline: []domain.MapPoint{{Longitude: mid[0], Latitude: mid[1]}, {Longitude: destination[0], Latitude: destination[1]}}},
	}

	gps := interpolateGPS(origin, destination, start, end, shipment.Status)
	return hubs, segments, gps
}

// routeTimeline bounds the schematic timeline with the earliest and latest
// on-chain event timestamps, falling back to "now minus 10h .. now".
func routeTimeline(events []domain.TrackingEvent) (time.Time, time.Time) {
	end := time.Now().UTC().Truncate(time.Minute)
	start := end.Add(-10 * time.Hour)
	earliest, latest := eventTimeRange(events)
	if !earliest.IsZero() {
		start = earliest
	}
	if !latest.IsZero() {
		end = latest
	}
	if !start.Before(end) {
		start = end.Add(-10 * time.Hour)
	}
	return start, end
}

func eventTimeRange(events []domain.TrackingEvent) (time.Time, time.Time) {
	var earliest, latest time.Time
	for _, event := range events {
		parsed, err := time.Parse(time.RFC3339, event.At)
		if err != nil {
			continue
		}
		if earliest.IsZero() || parsed.Before(earliest) {
			earliest = parsed
		}
		if latest.IsZero() || parsed.After(latest) {
			latest = parsed
		}
	}
	return earliest, latest
}

func interpolateGPS(origin, destination [2]float64, start, end time.Time, status string) []domain.MapPoint {
	if !end.After(start) {
		end = start.Add(10 * time.Hour)
	}
	speeds := []float64{0, 62, 78, 70, 0}
	switch status {
	case "ACCEPTED", "CREATED", "CANCELLED":
		speeds = []float64{0, 0, 0, 0, 0}
	case "PICKED_UP":
		speeds = []float64{0, 55, 0, 0, 0}
	}
	points := make([]domain.MapPoint, 0, 5)
	total := end.Sub(start).Seconds()
	for i := 0; i < 5; i++ {
		fraction := float64(i) / 4
		at := start.Add(time.Duration(total*fraction) * time.Second)
		if at.After(end) {
			at = end
		}
		points = append(points, domain.MapPoint{
			Longitude: origin[0] + (destination[0]-origin[0])*fraction,
			Latitude:  origin[1] + (destination[1]-origin[1])*fraction,
			At:        iso(at), Speed: speeds[i],
		})
	}
	return points
}

// temperatureFromEvents turns the temperature values recorded in on-chain
// checkpoint events into the chart series, instead of inventing readings.
func temperatureFromEvents(events []domain.TrackingEvent) []domain.TemperatureReading {
	readings := make([]domain.TemperatureReading, 0, len(events))
	for _, event := range events {
		if event.Temperature == nil {
			continue
		}
		readings = append(readings, domain.TemperatureReading{At: event.At, Value: *event.Temperature})
	}
	sort.Slice(readings, func(i, j int) bool { return readings[i].At < readings[j].At })
	return readings
}

func iso(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

func isoOrEmpty(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return iso(value)
}

func arrivedTime(end time.Time, status string) time.Time {
	if status == "NORMAL" {
		return end
	}
	return time.Time{}
}

func (s *ControlTowerService) Get(id string) (domain.ControlTower, error) {
	shipment, err := s.ledger.ReadShipment(id)
	if err != nil {
		return domain.ControlTower{}, err
	}
	var allHubs []domain.Hub
	var segments []domain.RouteSegment
	var gps []domain.MapPoint
	var temp []domain.TemperatureReading
	if s.data != nil {
		if allHubs, err = s.data.LoadHubs(); err != nil {
			return domain.ControlTower{}, fmt.Errorf("网点数据读取失败: %w", err)
		}
		h := map[string]domain.Hub{}
		for _, x := range allHubs {
			h[x.Code] = x
		}
		if segments, err = s.data.LoadSegments(id, h); err != nil {
			return domain.ControlTower{}, fmt.Errorf("路线数据读取失败: %w", err)
		}
		if gps, err = s.data.LoadGPS(id); err != nil {
			return domain.ControlTower{}, fmt.Errorf("GPS 数据读取失败: %w", err)
		}
		if temp, err = s.data.LoadTemperature(id); err != nil {
			return domain.ControlTower{}, fmt.Errorf("温湿度数据读取失败: %w", err)
		}
	} else {
		allHubs, segments, gps = deriveRoute(shipment)
		temp = temperatureFromEvents(shipment.Events)
	}
	if allHubs == nil {
		allHubs = []domain.Hub{}
	}
	if segments == nil {
		segments = []domain.RouteSegment{}
	}
	if gps == nil {
		gps = []domain.MapPoint{}
	}
	if temp == nil {
		temp = []domain.TemperatureReading{}
	}
	for i := range shipment.Events {
		for _, hub := range allHubs {
			if shipment.Events[i].HubCode == hub.Code {
				shipment.Events[i].HubName = hub.Name
			}
		}
	}
	tower := domain.ControlTower{Shipment: shipment, Hubs: allHubs, Segments: segments, GPS: gps, Temperature: temp}
	tower.DataSource = "demo"
	if s.data != nil {
		tower.DataSource = "mysql"
	}
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
