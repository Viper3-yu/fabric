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
			risks = append(risks, domain.Risk{ID: "delay-" + segment.ID, Type: "DELAY", Level: "HIGH", Title: "运输段延误", Description: "实际到达晚于计划到达，请核验承运与交接记录", SegmentID: segment.ID, Status: "RESOLVED"})
		}
	}
	for _, event := range events {
		if event.Type == "EXCEPTION" {
			risks = append(risks, domain.Risk{ID: "exception-" + event.ID, Type: "EXCEPTION", Level: event.Severity, Title: "运输异常", Description: event.Remark, HubCode: event.HubCode, RelatedEventID: event.ID, Status: "RESOLVED"})
		}
	}
	if len(gps) > 2 {
		// 演示模式：真实实现由 GIS 插件计算点到计划折线的距离。
		risks = append(risks, domain.Risk{ID: "gps-001", Type: "ROUTE_DEVIATION", Level: "MEDIUM", Title: "路线偏离预警", Description: "检测到连续 GPS 点偏离计划线路，需核验车辆状态", SegmentID: "SEG-03", Status: "RESOLVED"})
	}
	return risks
}
