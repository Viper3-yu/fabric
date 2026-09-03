package risk

import (
	"testing"

	"lianyun-backend/internal/domain"
)

func TestAnalyzeFindsDelayExceptionAndGPSRisk(t *testing.T) {
	segments := []domain.RouteSegment{{ID: "SEG-01", PlannedArrival: "2026-09-01T10:00:00Z", ActualArrival: "2026-09-01T10:05:00Z"}}
	events := []domain.TrackingEvent{{ID: "evt-1", Type: "EXCEPTION", Severity: "HIGH", Remark: "车辆故障"}}
	gps := []domain.MapPoint{{}, {}, {}}
	risks := Analyze(segments, events, gps)
	if len(risks) != 3 {
		t.Fatalf("expected 3 risks, got %d: %+v", len(risks), risks)
	}
}
