package api

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"tower-api/internal/domain"
	"tower-api/internal/service"
)

// Server fronts the control tower. Write operations are gated by the main
// API's session: the instance acting as Org1 only accepts the shipper role,
// and the instance acting as Org2 only accepts the carrier role, so one
// logged-in account can never perform both sides of a handover.
type Server struct {
	service     *service.ControlTowerService
	mode        string
	org         string
	secret      string
	allowedRole string
}

func New(s *service.ControlTowerService, mode, org, secret string) *Server {
	if mode == "" {
		mode = "mock"
	}
	if org == "" {
		org = "1"
	}
	allowedRole := "shipper"
	if org == "2" {
		allowedRole = "carrier"
	}
	return &Server{service: s, mode: mode, org: org, secret: secret, allowedRole: allowedRole}
}

func (s *Server) Router() *gin.Engine {
	r := gin.New()
	_ = r.SetTrustedProxies([]string{"127.0.0.1", "::1"})
	r.Use(gin.Logger(), gin.Recovery())
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "mode": s.mode, "org": "Org" + s.org + "MSP", "service": "lianyun-control-tower"})
	})
	r.GET("/api/shipments/:id/control-tower", s.controlTower)
	r.GET("/api/shipments/:id/map", s.controlTower)
	r.GET("/api/shipments/:id/risk-analysis", s.risk)

	// Chaincode-side authorization is enforced per organization (requireMSP),
	// so each write must go through the instance holding the matching org
	// identity AND the matching business role.
	writes := r.Group("/api", s.requireOrgRole)
	writes.POST("/shipments/:id/events", s.appendEvent)
	writes.POST("/shipments/:id/handovers", s.initiateHandover)
	writes.POST("/handovers/:handoverId/confirm", s.confirmHandover)
	return r
}

func (s *Server) requireOrgRole(c *gin.Context) {
	token, err := extractSessionToken(c)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"ok": false, "message": "请先登录主站后再执行链上操作"})
		return
	}
	claims, err := verifySessionToken(token, s.secret)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"ok": false, "message": "登录会话无效或已过期，请重新登录"})
		return
	}
	if claims.Role != s.allowedRole {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"ok":      false,
			"message": "该操作属于 Org" + s.org + "MSP 侧，需要「" + s.allowedRole + "」角色；当前角色「" + claims.Role + "」无权执行",
		})
		return
	}
	c.Set("actorRole", claims.Role)
	c.Set("actorID", claims.Subject)
	c.Next()
}

func (s *Server) initiateHandover(c *gin.Context) {
	var input struct {
		HandoverID string `json:"handoverId" binding:"required"`
		FromHub    string `json:"fromHub" binding:"required"`
		ToHub      string `json:"toHub" binding:"required"`
		CarrierOrg string `json:"carrierOrg" binding:"required"`
	}
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": "交接参数错误"})
		return
	}
	out, err := s.service.InitiateHandover(c.Param("id"), input.HandoverID, input.FromHub, input.ToHub, input.CarrierOrg)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": out})
}

func (s *Server) confirmHandover(c *gin.Context) {
	out, err := s.service.ConfirmHandover(c.Param("handoverId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": out})
}

func (s *Server) controlTower(c *gin.Context) {
	data, err := s.service.Get(c.Param("id"))
	if err != nil {
		log.Printf("control tower lookup failed: %v", err)
		status, message := http.StatusServiceUnavailable, "运输数据服务暂时不可用，请稍后重试"
		// The chaincode reports missing records in English ("does not
		// exist"); map both phrasings to a client-facing 404.
		if strings.Contains(err.Error(), "不存在") || strings.Contains(err.Error(), "does not exist") {
			status, message = http.StatusNotFound, "未找到该运单，请核对运单号（统一账本运单如 JXSEED0001–0012）"
		}
		c.JSON(status, gin.H{"ok": false, "message": message})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": data})
}

func (s *Server) risk(c *gin.Context) {
	data, err := s.service.Get(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": data.Risks})
}

func (s *Server) appendEvent(c *gin.Context) {
	var event domain.TrackingEvent
	if c.BindJSON(&event) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": "参数错误"})
		return
	}
	// The chaincode rejects a caller-supplied actorOrg that mismatches the
	// submitting MSP; the instance identity is the authority here.
	event.ActorOrg = "Org" + s.org + "MSP"
	if event.ActorName == "" {
		event.ActorName = "当前操作员"
	}
	event.Remark = strings.TrimSpace(event.Remark)
	out, err := s.service.Append(c.Param("id"), event)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": out})
}
