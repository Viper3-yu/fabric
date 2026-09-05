package service

import (
	"errors"
	"lianyun-backend/internal/domain"
	"lianyun-backend/internal/ledger"
	"testing"
)

type emptySource struct{ fail bool }

func (e emptySource) LoadHubs() ([]domain.Hub, error) {
	if e.fail {
		return nil, errors.New("database unavailable")
	}
	return nil, nil
}
func (e emptySource) LoadSegments(string, map[string]domain.Hub) ([]domain.RouteSegment, error) {
	return nil, nil
}
func (e emptySource) LoadGPS(string) ([]domain.MapPoint, error)                   { return nil, nil }
func (e emptySource) LoadTemperature(string) ([]domain.TemperatureReading, error) { return nil, nil }
func TestMissingTelemetryDoesNotBecomeDemoData(t *testing.T) {
	tower, err := NewControlTowerService(ledger.NewMock(), emptySource{}).Get("YT20260001")
	if err != nil {
		t.Fatal(err)
	}
	if len(tower.GPS) != 0 || len(tower.Temperature) != 0 || len(tower.Segments) != 0 || tower.DataSource != "mysql" {
		t.Fatalf("invented telemetry: %+v", tower)
	}
	if tower.GPS == nil || tower.Temperature == nil {
		t.Fatal("API arrays must not be null")
	}
}
func TestDatabaseFailureIsNotHidden(t *testing.T) {
	if _, err := NewControlTowerService(ledger.NewMock(), emptySource{fail: true}).Get("YT20260001"); err == nil {
		t.Fatal("expected database error")
	}
}
