package risk

import (
	"lianyun-backend/internal/domain"
	"time"
)

func Analyze(segments []domain.RouteSegment, events []domain.TrackingEvent, gps []domain.MapPoint) []domain.Risk {
	risks := []domain.Risk{}
	for _, segment := range segments {
		if segment.ActualArrival == "" {
			continue
		}
		planned, pErr := time.Parse(time.RFC3339, segment.PlannedArrival)
		actual, aErr := time.Parse(time.RFC3339, segment.ActualArrival)
		if pErr == nil && aErr == nil && actual.After(planned) {
			risks = append(risks, domain.Risk{ID: "delay-" + segment.ID, Type: "DELAY", Level: "MEDIUM", Title: "运输段延误", Description: "实际到达晚于计划到达，请核验承运与交接记录", SegmentID: segment.ID, Status: "OPEN"})
		}
	}
	for _, event := range events {
		if event.Type == "EXCEPTION" {
			status := "OPEN"
			started, startErr := time.Parse(time.RFC3339, event.At)
			for _, resolved := range events {
				ended, endErr := time.Parse(time.RFC3339, resolved.At)
				if resolved.Type == "EXCEPTION_RESOLVED" && event.HubCode != "" && resolved.HubCode == event.HubCode && startErr == nil && endErr == nil && ended.After(started) {
					status = "RESOLVED"
				}
			}
			level := event.Severity
			if level == "" {
				level = "MEDIUM"
			}
			risks = append(risks, domain.Risk{ID: "exception-" + event.ID, Type: "EXCEPTION", Level: level, Title: "运输异常", Description: event.Remark, HubCode: event.HubCode, RelatedEventID: event.ID, Status: status})
		}
	}
	// GPS point count alone cannot establish deviation; wait for a validated route geometry rule.
	return risks
}
