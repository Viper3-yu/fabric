package plugins

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"lianyun-backend/internal/domain"
	"math"
)

type GPSPlugin struct {
	Points      []GPSPoint
	Plans       map[string]RoutePlan
	DeviationKM float64
}

func (p *GPSPlugin) Name() string { return "gps" }
func (p *GPSPlugin) Ingest(shipmentID string, payload []byte) error {
	var items []GPSPoint
	if err := json.Unmarshal(payload, &items); err != nil {
		return err
	}
	for _, item := range items {
		if item.ShipmentID != "" && item.ShipmentID != shipmentID {
			return fmt.Errorf("运单号不一致")
		}
		item.ShipmentID = shipmentID
		p.Points = append(p.Points, item)
	}
	return nil
}
func (p *GPSPlugin) Summarize(shipmentID string) (TelemetrySummary, error) {
	var items []GPSPoint
	for _, x := range p.Points {
		if x.ShipmentID == shipmentID {
			items = append(items, x)
		}
	}
	raw, _ := json.Marshal(items)
	sum := sha256.Sum256(raw)
	risk := p.DetectDeviation(shipmentID)
	return TelemetrySummary{ShipmentID: shipmentID, Plugin: p.Name(), SHA256: hex.EncodeToString(sum[:]), AbnormalCount: len(risk), Message: "GPS 摘要可上链，原始坐标保留链下"}, nil
}
func (p *GPSPlugin) DetectDeviation(shipmentID string) []domain.Risk {
	threshold := p.DeviationKM
	if threshold == 0 {
		threshold = 1.5
	}
	var results []domain.Risk
	for segmentID, plan := range p.Plans {
		for _, x := range p.Points {
			if x.ShipmentID != shipmentID {
				continue
			}
			if distanceToPolyline(x, plan.Polyline) > threshold {
				results = append(results, domain.Risk{ID: "gps-" + segmentID, Type: "ROUTE_DEVIATION", Level: "MEDIUM", Title: "路线偏离预警", Description: "GPS 点偏离计划路线超过阈值，需核验车辆状态", SegmentID: segmentID, Status: "OPEN"})
				break
			}
		}
	}
	return results
}
func distanceToPolyline(p GPSPoint, line []domain.MapPoint) float64 {
	if len(line) < 2 {
		return 0
	}
	best := math.MaxFloat64
	for i := 0; i < len(line)-1; i++ {
		d := pointToSegmentKM(p, line[i], line[i+1])
		if d < best {
			best = d
		}
	}
	return best
}
func pointToSegmentKM(p GPSPoint, a, b domain.MapPoint) float64 {
	// 小范围采用等距投影近似，适合城市/干线偏离预警；生产环境可替换为 GIS 引擎。
	const r = 6371.0
	lat0 := p.Latitude * math.Pi / 180
	x := func(lng float64) float64 { return r * lng * math.Pi / 180 * math.Cos(lat0) }
	y := func(lat float64) float64 { return r * lat * math.Pi / 180 }
	px, py := x(p.Longitude), y(p.Latitude)
	ax, ay := x(a.Longitude), y(a.Latitude)
	bx, by := x(b.Longitude), y(b.Latitude)
	dx, dy := bx-ax, by-ay
	if dx == 0 && dy == 0 {
		return math.Hypot(px-ax, py-ay)
	}
	t := ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy)
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	return math.Hypot(px-(ax+t*dx), py-(ay+t*dy))
}
