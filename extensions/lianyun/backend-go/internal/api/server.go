package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"lianyun-backend/internal/domain"
	"lianyun-backend/internal/service"
)

type Server struct {
	service *service.ControlTowerService
	mode    string
}

func New(s *service.ControlTowerService, mode ...string) *Server {
	m := "mock"
	if len(mode) > 0 && mode[0] != "" {
		m = mode[0]
	}
	return &Server{service: s, mode: m}
}

func (s *Server) Router() *gin.Engine {
	r := gin.New()
	_ = r.SetTrustedProxies([]string{"127.0.0.1", "::1"})
	r.Use(gin.Logger(), gin.Recovery())
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "mode": s.mode, "service": "lianyun-control-tower"})
	})
	r.POST("/api/auth/login", func(c *gin.Context) {
		var input struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if c.BindJSON(&input) != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": "参数错误"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
			"accessToken": "demo-token-" + input.Username,
			"user":        gin.H{"name": "演示用户", "role": "CARRIER"},
		}})
	})
	r.GET("/api/shipments/:id/control-tower", s.controlTower)
	r.GET("/api/shipments/:id/map", s.controlTower)
	r.GET("/api/shipments/:id/risk-analysis", s.risk)
	r.POST("/api/shipments/:id/events", s.appendEvent)
	r.POST("/api/shipments/:id/handovers", s.initiateHandover)
	r.POST("/api/handovers/:handoverId/confirm", s.confirmHandover)
	return r
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
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "message": err.Error()})
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
