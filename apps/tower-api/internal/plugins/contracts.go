package plugins

import "tower-api/internal/domain"

type TelemetryPlugin interface {
	Name() string
	Ingest(shipmentID string, payload []byte) error
	Summarize(shipmentID string) (TelemetrySummary, error)
}

type TelemetrySummary struct {
	ShipmentID    string `json:"shipmentId"`
	Plugin        string `json:"plugin"`
	SHA256        string `json:"sha256"`
	AbnormalCount int    `json:"abnormalCount"`
	Message       string `json:"message"`
}

type GPSPoint struct {
	ShipmentID string  `json:"shipmentId"`
	Longitude  float64 `json:"longitude"`
	Latitude   float64 `json:"latitude"`
	RecordedAt string  `json:"recordedAt"`
	SpeedKMH   float64 `json:"speedKmh"`
}

type TemperaturePoint struct {
	ShipmentID   string  `json:"shipmentId"`
	RecordedAt   string  `json:"recordedAt"`
	TemperatureC float64 `json:"temperatureC"`
	Humidity     float64 `json:"humidity"`
	DeviceCode   string  `json:"deviceCode"`
}

type RoutePlan struct {
	SegmentID string            `json:"segmentId"`
	Polyline  []domain.MapPoint `json:"polyline"`
}
