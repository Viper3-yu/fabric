package main

import (
	"fmt"
	"log"
	"net"
	"os"
	"strings"

	"tower-api/internal/api"
	"tower-api/internal/ledger"
	"tower-api/internal/repository"
	"tower-api/internal/service"
)

// loadEnvFile reads KEY=VALUE lines into the process environment without
// overriding variables that are already set. It accepts the same file format
// as apps/api/.env.fabric.
func loadEnvFile(path string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, strings.TrimSpace(value))
		}
	}
	return nil
}

func envDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

// lookupOrg resolves FABRIC_ORG{n}_{FIELD} first and falls back to the
// generic FABRIC_{FIELD} name, so one env file can drive both org instances.
func lookupOrg(org, field string) string {
	if value := os.Getenv("FABRIC_ORG" + org + "_" + field); value != "" {
		return value
	}
	return os.Getenv("FABRIC_" + field)
}

func main() {
	if err := loadEnvFile(os.Getenv("ENV_FILE")); err != nil {
		log.Fatalf("加载 ENV_FILE 失败: %v", err)
	}
	port := envDefault("PORT", "8080")
	mode := envDefault("LEDGER_MODE", "mock")
	org := envDefault("TOWER_ORG", "1")

	var l ledger.Client = ledger.NewMock()
	if mode == "fabric" {
		mspID := envDefault("FABRIC_ORG"+org+"_MSP_ID", "Org"+org+"MSP")
		f, err := ledger.NewFabric(ledger.FabricConfig{
			MSPID:         mspID,
			CertPath:      lookupOrg(org, "CERT_PATH"),
			KeyPath:       lookupOrg(org, "KEY_PATH"),
			TLSCertPath:   lookupOrg(org, "TLS_CERT_PATH"),
			PeerEndpoint:  lookupOrg(org, "PEER_ENDPOINT"),
			PeerHostAlias: lookupOrg(org, "PEER_HOST_ALIAS"),
			Channel:       envDefault("FABRIC_CHANNEL", "logisticschannel"),
			Chaincode:     envDefault("FABRIC_CHAINCODE", "logistics"),
		})
		if err != nil {
			log.Fatal(err)
		}
		defer f.Close()
		l = f
	}
	var sources []service.DataSource
	if dsn := os.Getenv("MYSQL_DSN"); dsn != "" {
		db, err := repository.NewMySQL(dsn)
		if err != nil {
			log.Fatal(err)
		}
		defer db.Close()
		sources = append(sources, db)
	}
	r := api.New(service.NewControlTowerService(l, sources...), mode, org, os.Getenv("JWT_SECRET")).Router()
	if err := r.Run(net.JoinHostPort(os.Getenv("HOST"), port)); err != nil {
		log.Fatal(fmt.Errorf("listen on %s: %w", net.JoinHostPort(os.Getenv("HOST"), port), err))
	}
}
