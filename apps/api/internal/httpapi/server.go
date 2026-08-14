package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/Viper3-yu/fabric/apps/api/internal/apperror"
	"github.com/Viper3-yu/fabric/apps/api/internal/auth"
	"github.com/Viper3-yu/fabric/apps/api/internal/config"
	"github.com/Viper3-yu/fabric/apps/api/internal/ledger"
	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
)

type contextKey string

const (
	requestIDKey contextKey = "request-id"
)

var publicEventDescriptions = map[string]string{
	model.EventCreated:           "运单已创建",
	model.EventAccepted:          "承运方已接单",
	model.EventPickedUp:          "货物已揽收",
	model.EventCheckpoint:        "运输节点已更新",
	model.EventExceptionReported: "运输异常已记录",
	model.EventExceptionResolved: "运输异常已处理",
	model.EventDelivered:         "货物已送达",
	model.EventReceived:          "收货方已确认收货",
	model.EventCancelled:         "运单已取消",
}

type API struct {
	config   config.Config
	ledger   ledger.Ledger
	mux      *http.ServeMux
	throttle loginThrottle
}

func New(cfg config.Config, store ledger.Ledger) http.Handler {
	api := &API{config: cfg, ledger: store, mux: http.NewServeMux()}
	api.routes()
	return api.middleware(api.mux)
}

func (a *API) routes() {
	a.mux.HandleFunc("GET /api/health", a.handleHealth)
	a.mux.HandleFunc("GET /api/network", a.handleNetwork)
	a.mux.HandleFunc("GET /api/network/mode", a.handleNetwork)
	a.mux.HandleFunc("POST /api/auth/login", a.handleLogin)
	a.mux.HandleFunc("GET /api/auth/me", a.withAuth(a.handleMe))
	a.mux.HandleFunc("GET /api/dashboard/summary", a.withAuth(a.handleDashboard))
	a.mux.HandleFunc("GET /api/shipments", a.withAuth(a.handleListShipments))
	a.mux.HandleFunc("POST /api/shipments", a.withRole([]string{"shipper"}, a.handleCreateShipment))
	a.mux.HandleFunc("GET /api/shipments/{id}", a.withAuth(a.handleReadShipment))
	a.mux.HandleFunc("GET /api/shipments/{id}/history", a.withAuth(a.handleShipmentHistory))
	a.mux.HandleFunc(
		"POST /api/shipments/{id}/actions/{action}",
		a.withAuth(a.handleShipmentAction),
	)
	a.mux.HandleFunc("GET /api/public/track/{trackingNumber}", a.handlePublicTrack)
	a.mux.HandleFunc("GET /api/public/track/{trackingNumber}/history", a.handlePublicHistory)
	a.mux.HandleFunc("POST /api/public/verify", a.handleVerify)
	a.mux.HandleFunc("/", func(response http.ResponseWriter, request *http.Request) {
		a.writeError(response, request, apperror.New(
			404, "ROUTE_NOT_FOUND",
			fmt.Sprintf("Route %s %s was not found", request.Method, request.URL.Path),
		))
	})
}

func (a *API) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				if a.config.Environment != "test" {
					log.Printf("panic: %v", recovered)
				}
				a.writeError(response, request, apperror.New(
					500, "INTERNAL_ERROR", "The server could not complete the request",
				))
			}
		}()

		requestID := strings.TrimSpace(request.Header.Get("x-request-id"))
		if runes := []rune(requestID); len(runes) > 100 {
			requestID = string(runes[:100])
		}
		if requestID == "" {
			requestID = randomID()
		}
		request = request.WithContext(context.WithValue(request.Context(), requestIDKey, requestID))
		response.Header().Set("x-request-id", requestID)
		response.Header().Set("x-content-type-options", "nosniff")
		response.Header().Set("referrer-policy", "no-referrer")

		origin := request.Header.Get("Origin")
		if origin != "" {
			if !a.originAllowed(origin) {
				a.writeError(response, request, apperror.New(403, "CORS_FORBIDDEN", "Origin is not allowed"))
				return
			}
			response.Header().Set("Access-Control-Allow-Origin", origin)
			response.Header().Set("Vary", "Origin")
			response.Header().Set("Access-Control-Expose-Headers", "x-request-id")
		}
		if request.Method == http.MethodOptions {
			response.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			response.Header().Set("Access-Control-Allow-Headers", "authorization,content-type,x-request-id")
			response.Header().Set("Access-Control-Max-Age", "600")
			response.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(response, request)
	})
}

func (a *API) handleHealth(response http.ResponseWriter, request *http.Request) {
	health := a.ledger.Health(request.Context())
	status := http.StatusOK
	if health.Status != "ok" {
		status = http.StatusServiceUnavailable
	}
	a.sendSuccess(response, request, map[string]any{
		"status": health.Status, "service": "jixin-api",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano), "ledger": publicHealth(health),
	}, status)
}

func (a *API) handleNetwork(response http.ResponseWriter, request *http.Request) {
	mode := a.ledger.Mode()
	a.sendSuccess(response, request, map[string]any{
		"mode": mode, "isDemo": mode == "demo",
		"label":  map[bool]string{true: "演示账本", false: "Hyperledger Fabric"}[mode == "demo"],
		"health": publicHealth(a.ledger.Health(request.Context())),
	}, http.StatusOK)
}

// publicHealth drops ledger diagnostics (gRPC errors may embed peer endpoints
// or local paths); the API log keeps the full detail.
func publicHealth(health ledger.Health) ledger.Health {
	health.Details = ""
	return health
}

func (a *API) handleLogin(response http.ResponseWriter, request *http.Request) {
	var body loginBody
	if err := decodeJSON(request, &body); err != nil {
		a.writeError(response, request, err)
		return
	}
	if err := validateLogin(&body); err != nil {
		a.writeError(response, request, err)
		return
	}
	if a.throttle.locked(body.Username) {
		a.writeError(response, request, apperror.New(
			429, "TOO_MANY_ATTEMPTS",
			"Too many failed sign-in attempts; wait briefly and try again",
		))
		return
	}
	user, err := auth.Authenticate(body.Username, body.Password)
	if err != nil {
		a.throttle.recordFailure(body.Username)
		a.writeError(response, request, err)
		return
	}
	a.throttle.recordSuccess(body.Username)
	token, err := auth.CreateToken(user, a.config.JWTSecret, a.config.JWTExpiresIn)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	a.sendSuccess(response, request, map[string]any{
		"token": token, "user": user, "ledgerMode": a.ledger.Mode(),
	}, http.StatusOK)
}

const (
	loginMaxFailures  = 5
	loginLockDuration = 30 * time.Second
)

type loginAttempt struct {
	failures    int
	lockedUntil time.Time
}

type loginThrottle struct {
	mu       sync.Mutex
	attempts map[string]*loginAttempt
}

func (t *loginThrottle) locked(username string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	attempt, ok := t.attempts[username]
	if !ok {
		return false
	}
	if attempt.lockedUntil.After(time.Now()) {
		return true
	}
	if !attempt.lockedUntil.IsZero() {
		delete(t.attempts, username)
	}
	return false
}

func (t *loginThrottle) recordFailure(username string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.attempts == nil {
		t.attempts = make(map[string]*loginAttempt)
	}
	attempt, ok := t.attempts[username]
	if !ok {
		attempt = &loginAttempt{}
		t.attempts[username] = attempt
	}
	attempt.failures++
	if attempt.failures >= loginMaxFailures {
		attempt.lockedUntil = time.Now().Add(loginLockDuration)
	}
}

func (t *loginThrottle) recordSuccess(username string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.attempts, username)
}

func (a *API) handleMe(response http.ResponseWriter, request *http.Request, user model.User) {
	a.sendSuccess(response, request, map[string]any{
		"user": user, "ledgerMode": a.ledger.Mode(),
	}, http.StatusOK)
}

func (a *API) handleDashboard(response http.ResponseWriter, request *http.Request, user model.User) {
	shipments, err := a.ledger.GetAllShipments(request.Context(), &user)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	visible := filterVisible(shipments, user)
	sort.Slice(visible, func(i, j int) bool { return visible[i].UpdatedAt > visible[j].UpdatedAt })
	summary := map[string]any{
		"total":          len(visible),
		"inTransit":      countStatuses(visible, model.StatusAccepted, model.StatusPickedUp, model.StatusInTransit),
		"exceptions":     countStatuses(visible, model.StatusException),
		"pendingReceipt": countStatuses(visible, model.StatusDelivered),
		"completed":      countStatuses(visible, model.StatusReceived),
		"recent":         visible[:minimum(5, len(visible))],
	}
	a.sendSuccess(response, request, summary, http.StatusOK)
}

func (a *API) handleListShipments(response http.ResponseWriter, request *http.Request, user model.User) {
	query := request.URL.Query()
	for key := range query {
		if key != "status" && key != "search" && key != "limit" && key != "offset" {
			a.writeError(response, request, validationError(fmt.Errorf("unknown query parameter %s", key)))
			return
		}
	}
	status := strings.TrimSpace(query.Get("status"))
	if status != "" && !validStatus(status) {
		a.writeError(response, request, validationError(fmt.Errorf("status is invalid")))
		return
	}
	search := strings.ToLower(strings.TrimSpace(query.Get("search")))
	if utf8.RuneCountInString(search) > 100 {
		a.writeError(response, request, validationError(fmt.Errorf("search must not exceed 100 characters")))
		return
	}
	limit, err := parseLimit(query.Get("limit"), 20, 1, 100, "limit")
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	offset, err := parseLimit(query.Get("offset"), 0, 0, int(^uint(0)>>1), "offset")
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	shipments, err := a.ledger.GetAllShipments(request.Context(), &user)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	result := make([]model.Shipment, 0)
	for _, shipment := range shipments {
		if !canView(user, shipment) || (status != "" && shipment.Status != status) {
			continue
		}
		if search != "" && !shipmentMatches(shipment, search) {
			continue
		}
		result = append(result, shipment)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].UpdatedAt > result[j].UpdatedAt })
	start := minimum(offset, len(result))
	end := minimum(start+limit, len(result))
	a.sendSuccess(response, request, map[string]any{
		"items": result[start:end], "total": len(result), "limit": limit, "offset": offset,
	}, http.StatusOK)
}

func (a *API) handleCreateShipment(response http.ResponseWriter, request *http.Request, user model.User) {
	var body createShipmentBody
	if err := decodeJSON(request, &body); err != nil {
		a.writeError(response, request, err)
		return
	}
	if err := validateCreate(&body); err != nil {
		a.writeError(response, request, err)
		return
	}
	deliveryCode, err := sixDigitCode()
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	command := ledger.CreateShipmentCommand{
		ID: "shipment-" + randomID(), TrackingNumber: trackingNumber(),
		Origin: toAddress(body.Origin), Destination: toAddress(body.Destination),
		Goods: model.GoodsInfo{
			Name: body.Goods.Name, Category: body.Goods.Category,
			Quantity: int(body.Goods.Quantity), WeightKG: float64(body.Goods.WeightKG),
			Description: body.Goods.Description,
		},
		RecipientMasked:      maskName(body.Destination.ContactName) + " · " + maskPhone(body.Destination.ContactPhone),
		ExpectedDeliveryDate: body.ExpectedDeliveryDate,
		DeliveryCodeHash:     sha256Hex(deliveryCode), DocumentHash: body.DocumentHash,
	}
	if body.TemperatureRange != nil {
		command.TemperatureRange = &model.TemperatureRange{
			Min: float64(body.TemperatureRange.Min), Max: float64(body.TemperatureRange.Max), Unit: "C",
		}
	}
	receipt, err := a.ledger.CreateShipment(request.Context(), command, user)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	a.sendSuccess(response, request, map[string]any{
		"transactionId": receipt.TransactionID, "committedAt": receipt.CommittedAt,
		"ledgerMode": receipt.LedgerMode, "data": receipt.Data, "deliveryCode": deliveryCode,
	}, http.StatusCreated)
}

func (a *API) handleReadShipment(response http.ResponseWriter, request *http.Request, user model.User) {
	id, err := pathValue(request, "id", 1, 100)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	shipment, err := a.ledger.ReadShipment(request.Context(), id, &user)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	if !canView(user, shipment) {
		a.writeError(response, request, apperror.New(
			403, "SHIPMENT_NOT_VISIBLE", "This shipment is not visible to your account",
		))
		return
	}
	a.sendSuccess(response, request, shipment, http.StatusOK)
}

func (a *API) handleShipmentHistory(response http.ResponseWriter, request *http.Request, user model.User) {
	id, err := pathValue(request, "id", 1, 100)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	shipment, err := a.ledger.ReadShipment(request.Context(), id, &user)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	if !canView(user, shipment) {
		a.writeError(response, request, apperror.New(
			403, "SHIPMENT_NOT_VISIBLE", "This shipment is not visible to your account",
		))
		return
	}
	history, err := a.ledger.GetShipmentHistory(request.Context(), id, &user)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	a.sendSuccess(response, request, history, http.StatusOK)
}

func (a *API) handleShipmentAction(response http.ResponseWriter, request *http.Request, user model.User) {
	action := request.PathValue("action")
	roles := map[string][]string{
		"accept": {"carrier"}, "pickup": {"carrier"}, "checkpoint": {"carrier"},
		"exception": {"carrier"}, "resolve": {"carrier"}, "deliver": {"carrier"},
		"confirm": {"receiver"}, "cancel": {"shipper"},
	}
	allowed, exists := roles[action]
	if !exists {
		a.writeError(response, request, apperror.New(404, "ROUTE_NOT_FOUND", "Shipment action was not found"))
		return
	}
	if !contains(allowed, user.Role) {
		a.writeError(response, request, apperror.New(403, "FORBIDDEN", "Your role cannot perform this action"))
		return
	}
	id, err := pathValue(request, "id", 1, 100)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	var body actionBody
	if err := decodeJSON(request, &body); err != nil {
		a.writeError(response, request, err)
		return
	}
	if err := validateAction(action, &body); err != nil {
		a.writeError(response, request, err)
		return
	}
	command := ledger.ActionCommand{
		Location: body.Location, Description: body.Description, EvidenceHash: body.EvidenceHash,
	}
	if body.Temperature != nil {
		value := float64(*body.Temperature)
		command.Temperature = &value
	}
	var receipt model.LedgerReceipt
	switch action {
	case "accept":
		receipt, err = a.ledger.AcceptShipment(request.Context(), id, command, user)
	case "pickup":
		receipt, err = a.ledger.PickupShipment(request.Context(), id, command, user)
	case "checkpoint":
		receipt, err = a.ledger.AddCheckpoint(request.Context(), id, command, user)
	case "exception":
		receipt, err = a.ledger.ReportException(request.Context(), id, command, user)
	case "resolve":
		receipt, err = a.ledger.ResolveException(request.Context(), id, command, user)
	case "deliver":
		receipt, err = a.ledger.MarkDelivered(request.Context(), id, command, user)
	case "confirm":
		receipt, err = a.ledger.ConfirmReceipt(request.Context(), id, ledger.ConfirmCommand{
			ActionCommand: command, DeliveryCode: body.DeliveryCode,
		}, user)
	case "cancel":
		command.Description = body.Reason
		receipt, err = a.ledger.CancelShipment(request.Context(), id, command, user)
	}
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	a.sendSuccess(response, request, receipt, http.StatusOK)
}

func (a *API) handlePublicTrack(response http.ResponseWriter, request *http.Request) {
	number, err := pathValue(request, "trackingNumber", 4, 100)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	if !validTrackingNumber(number) {
		a.writeError(response, request, invalidTrackingError())
		return
	}
	shipment, err := a.findByTracking(request.Context(), number)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	a.sendSuccess(response, request, publicShipment(shipment), http.StatusOK)
}

func (a *API) handlePublicHistory(response http.ResponseWriter, request *http.Request) {
	number, err := pathValue(request, "trackingNumber", 4, 100)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	if !validTrackingNumber(number) {
		a.writeError(response, request, invalidTrackingError())
		return
	}
	shipment, err := a.findByTracking(request.Context(), number)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	history, err := a.ledger.GetShipmentHistory(request.Context(), shipment.ID, nil)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	result := make([]map[string]any, 0, len(history))
	for _, entry := range history {
		value := any(nil)
		if entry.Value != nil {
			value = publicShipment(*entry.Value)
		}
		result = append(result, map[string]any{
			"txId": entry.TxID, "timestamp": entry.Timestamp,
			"isDelete": entry.IsDelete, "value": value,
		})
	}
	a.sendSuccess(response, request, result, http.StatusOK)
}

func (a *API) handleVerify(response http.ResponseWriter, request *http.Request) {
	var body verifyBody
	if err := decodeJSON(request, &body); err != nil {
		a.writeError(response, request, err)
		return
	}
	if err := validateVerify(&body); err != nil {
		a.writeError(response, request, err)
		return
	}
	shipment, err := a.findByTracking(request.Context(), body.TrackingNumber)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	history, err := a.ledger.GetShipmentHistory(request.Context(), shipment.ID, nil)
	if err != nil {
		a.writeError(response, request, err)
		return
	}
	continuous := historyIsContinuous(shipment, history)
	evidenceMatches := body.EvidenceHash == "" || strings.EqualFold(shipment.DocumentHash, body.EvidenceHash)
	if !evidenceMatches {
		for _, event := range shipment.Events {
			if strings.EqualFold(event.EvidenceHash, body.EvidenceHash) {
				evidenceMatches = true
				break
			}
		}
	}
	warnings := make([]string, 0)
	if !continuous {
		warnings = append(warnings, "账本历史或事件序列不连续")
	}
	if !evidenceMatches {
		warnings = append(warnings, "提交的证据摘要未在运单记录中找到")
	}
	if a.ledger.Mode() == "demo" {
		warnings = append(warnings, "演示账本结果仅用于流程预览，不构成真实上链证明")
	}
	a.sendSuccess(response, request, map[string]any{
		"trackingNumber": shipment.TrackingNumber,
		"verified":       a.ledger.Mode() == "fabric" && continuous && evidenceMatches,
		"ledgerMode":     a.ledger.Mode(), "status": shipment.Status,
		"eventCount": len(shipment.Events), "historyContinuous": continuous,
		"checkedAt": time.Now().UTC().Format(time.RFC3339Nano), "warnings": warnings,
	}, http.StatusOK)
}

func (a *API) withAuth(
	next func(http.ResponseWriter, *http.Request, model.User),
) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		token, err := auth.Bearer(request.Header.Get("Authorization"))
		if err != nil {
			a.writeError(response, request, apperror.New(401, "AUTH_REQUIRED", "A Bearer token is required"))
			return
		}
		user, err := auth.VerifyToken(token, a.config.JWTSecret)
		if err != nil {
			a.writeError(response, request, apperror.New(
				401, "INVALID_TOKEN", "The access token is invalid or expired",
			))
			return
		}
		next(response, request, user)
	}
}

func (a *API) withRole(
	roles []string,
	next func(http.ResponseWriter, *http.Request, model.User),
) http.HandlerFunc {
	return a.withAuth(func(response http.ResponseWriter, request *http.Request, user model.User) {
		if !contains(roles, user.Role) {
			a.writeError(response, request, apperror.New(403, "FORBIDDEN", "Your role cannot perform this action"))
			return
		}
		next(response, request, user)
	})
}

func (a *API) sendSuccess(
	response http.ResponseWriter,
	request *http.Request,
	data any,
	status int,
) {
	a.writeJSON(response, status, map[string]any{
		"success": true,
		"data":    data,
		"meta": map[string]any{
			"ledgerMode": a.ledger.Mode(), "requestId": requestID(request),
		},
	})
}

func (a *API) writeError(response http.ResponseWriter, request *http.Request, err error) {
	status := http.StatusInternalServerError
	code := "INTERNAL_ERROR"
	message := "The server could not complete the request"
	var details any
	var appError *apperror.Error
	if errors.As(err, &appError) {
		status = appError.Status
		code = appError.Code
		message = appError.Message
		details = appError.Details
	} else if a.config.Environment != "test" {
		log.Printf("request failed: %v", err)
	}
	payload := map[string]any{
		"code": code, "message": message, "requestId": requestID(request),
	}
	if details != nil {
		payload["details"] = details
	}
	a.writeJSON(response, status, map[string]any{"success": false, "error": payload})
}

func (a *API) writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func (a *API) findByTracking(ctx context.Context, number string) (model.Shipment, error) {
	return a.ledger.ReadShipmentByTracking(ctx, number, nil)
}

func (a *API) originAllowed(origin string) bool {
	for _, allowed := range a.config.CORSOrigins {
		if allowed == "*" || allowed == origin {
			return true
		}
	}
	return false
}

func publicShipment(shipment model.Shipment) map[string]any {
	events := make([]map[string]any, 0, len(shipment.Events))
	for _, event := range shipment.Events {
		value := map[string]any{
			"sequence": event.Sequence, "type": event.Type, "location": event.Location,
			"description": publicEventDescriptions[event.Type], "mspId": event.MSPID,
			"txId": event.TxID, "timestamp": event.Timestamp,
		}
		if event.Temperature != nil {
			value["temperature"] = *event.Temperature
		}
		if event.EvidenceHash != "" {
			value["evidenceHash"] = event.EvidenceHash
		}
		events = append(events, value)
	}
	result := map[string]any{
		"docType": shipment.DocType, "id": shipment.ID,
		"trackingNumber": shipment.TrackingNumber, "status": shipment.Status,
		"shipperName": shipment.ShipperName,
		"origin":      publicAddress(shipment.Origin), "destination": publicAddress(shipment.Destination),
		"goods": map[string]any{
			"name": shipment.Goods.Name, "category": shipment.Goods.Category,
			"quantity": shipment.Goods.Quantity, "weightKg": shipment.Goods.WeightKG,
		},
		"recipientMasked":      maskRecipient(shipment.RecipientMasked),
		"expectedDeliveryDate": shipment.ExpectedDeliveryDate,
		"events":               events, "anomalyCount": shipment.AnomalyCount,
		"lastLocation": shipment.LastLocation, "createdAt": shipment.CreatedAt,
		"updatedAt": shipment.UpdatedAt,
	}
	if shipment.CarrierName != "" {
		result["carrierName"] = shipment.CarrierName
	}
	if shipment.TemperatureRange != nil {
		result["temperatureRange"] = shipment.TemperatureRange
	}
	return result
}

func publicAddress(address model.Address) map[string]any {
	result := map[string]any{
		"province": address.Province, "city": address.City,
		"detail": "详细地址已脱敏", "contactName": maskName(address.ContactName),
		"contactPhoneMasked": address.ContactPhoneMasked,
	}
	if address.District != "" {
		result["district"] = address.District
	}
	return result
}

func historyIsContinuous(
	shipment model.Shipment,
	history []model.ShipmentHistoryEntry,
) bool {
	if len(history) == 0 {
		return false
	}
	historyTransactions := make(map[string]bool, len(history))
	for index, entry := range history {
		if entry.IsDelete || entry.Value == nil ||
			entry.Value.ID != shipment.ID ||
			entry.Value.TrackingNumber != shipment.TrackingNumber ||
			(index > 0 && entry.Timestamp < history[index-1].Timestamp) {
			return false
		}
		historyTransactions[entry.TxID] = true
	}
	for index, event := range shipment.Events {
		if event.Sequence != index+1 || !historyTransactions[event.TxID] {
			return false
		}
	}
	last := history[len(history)-1].Value
	return last != nil && last.UpdatedAt == shipment.UpdatedAt && last.Status == shipment.Status
}

func canView(user model.User, shipment model.Shipment) bool {
	switch user.Role {
	case "shipper":
		return shipment.ShipperID == user.ID
	case "carrier":
		return shipment.Status == model.StatusCreated || shipment.CarrierID == user.ID
	case "receiver":
		return shipment.Status == model.StatusDelivered || shipment.Status == model.StatusReceived
	case "auditor":
		return true
	default:
		return false
	}
}

func filterVisible(shipments []model.Shipment, user model.User) []model.Shipment {
	result := make([]model.Shipment, 0, len(shipments))
	for _, shipment := range shipments {
		if canView(user, shipment) {
			result = append(result, shipment)
		}
	}
	return result
}

func countStatuses(shipments []model.Shipment, statuses ...string) int {
	count := 0
	for _, shipment := range shipments {
		if contains(statuses, shipment.Status) {
			count++
		}
	}
	return count
}

func shipmentMatches(shipment model.Shipment, search string) bool {
	values := []string{
		shipment.TrackingNumber, shipment.Goods.Name, shipment.Origin.City,
		shipment.Destination.City, shipment.RecipientMasked,
	}
	for _, value := range values {
		if strings.Contains(strings.ToLower(value), search) {
			return true
		}
	}
	return false
}

func validStatus(value string) bool {
	return contains(model.ShipmentStatuses, value)
}

func pathValue(request *http.Request, name string, minimumLength, maximumLength int) (string, error) {
	value := strings.TrimSpace(request.PathValue(name))
	if err := length(value, minimumLength, maximumLength, name); err != nil {
		return "", validationError(err)
	}
	return value, nil
}

func requestID(request *http.Request) string {
	value, _ := request.Context().Value(requestIDKey).(string)
	return value
}

func toAddress(body addressBody) model.Address {
	return model.Address{
		Province: body.Province, City: body.City, District: body.District, Detail: body.Detail,
		ContactName: maskName(body.ContactName), ContactPhoneMasked: maskPhone(body.ContactPhone),
	}
}

func maskName(value string) string {
	runes := []rune(value)
	if len(runes) <= 1 {
		return value + "*"
	}
	count := minimum(2, len(runes)-1)
	return string(runes[:1]) + strings.Repeat("*", count)
}

func maskPhone(value string) string {
	var normalized strings.Builder
	for _, character := range value {
		if character == '+' || (character >= '0' && character <= '9') {
			normalized.WriteRune(character)
		}
	}
	phone := normalized.String()
	if len(phone) <= 7 {
		return phone[:minimum(2, len(phone))] + "***" + phone[maximum(0, len(phone)-2):]
	}
	return phone[:3] + "****" + phone[len(phone)-4:]
}

func maskRecipient(value string) string {
	parts := strings.Split(value, "·")
	name := strings.TrimSpace(parts[0])
	if name == "" {
		return "**"
	}
	if len(parts) > 1 {
		return maskName(name) + " · " + strings.TrimSpace(strings.Join(parts[1:], " · "))
	}
	return maskName(name)
}

func sixDigitCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(900000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", value.Int64()+100000), nil
}

func trackingNumber() string {
	value, err := rand.Int(rand.Reader, big.NewInt(100000000))
	if err != nil {
		value = big.NewInt(time.Now().UnixNano() % 100000000)
	}
	return "JX" + time.Now().UTC().Format("20060102") + fmt.Sprintf("%08d", value.Int64())
}

func randomID() string {
	content := make([]byte, 16)
	if _, err := rand.Read(content); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(content)
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func minimum(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maximum(left, right int) int {
	if left > right {
		return left
	}
	return right
}
