package risk

import (
	"testing"

	"lianyun-backend/internal/domain"
)

func TestAnalyzeDoesNotInventGPSRisk(t *testing.T) {
	segments := []domain.RouteSegment{{ID: "SEG-01", PlannedArrival: "2026-09-01T10:00:00Z", ActualArrival: "2026-09-01T10:05:00Z"}}
	events := []domain.TrackingEvent{{ID: "evt-1", Type: "EXCEPTION", Severity: "HIGH", Remark: "车辆故障"}}
	gps := []domain.MapPoint{{}, {}, {}}
	risks := Analyze(segments, events, gps)
	if len(risks) != 2 || risks[0].Status != "OPEN" || risks[1].Status != "OPEN" {
		t.Fatalf("expected two open evidence-based risks: %+v", risks)
	}
}

func TestResolutionRequiresSameHubAndLaterTime(t *testing.T) {
	base := domain.TrackingEvent{ID: "e", Type: "EXCEPTION", HubCode: "HZ", At: "2026-09-01T10:00:00Z"}
	for _, tc := range []struct{ hub, at, want string }{
		{"BJ", "2026-09-01T11:00:00Z", "OPEN"},
		{"HZ", "2026-09-01T09:00:00Z", "OPEN"},
		{"HZ", "2026-09-01T11:00:00Z", "RESOLVED"},
	} {
		got := Analyze(nil, []domain.TrackingEvent{base, {Type: "EXCEPTION_RESOLVED", HubCode: tc.hub, At: tc.at}}, nil)
		if got[0].Status != tc.want {
			t.Fatalf("%+v: %+v", tc, got)
		}
	}
}
