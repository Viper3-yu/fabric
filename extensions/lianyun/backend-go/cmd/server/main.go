package main

import (
	"lianyun-backend/internal/api"
	"lianyun-backend/internal/ledger"
	"lianyun-backend/internal/repository"
	"lianyun-backend/internal/service"
	"log"
	"net"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	mode := os.Getenv("LEDGER_MODE")
	if mode == "" {
		mode = "mock"
	}
	var l ledger.Client = ledger.NewMock()
	if mode == "fabric" {
		f, err := ledger.NewFabric(ledger.FabricConfig{MSPID: os.Getenv("FABRIC_MSP_ID"), CertPath: os.Getenv("FABRIC_CERT_PATH"), KeyPath: os.Getenv("FABRIC_KEY_PATH"), TLSCertPath: os.Getenv("FABRIC_TLS_CERT_PATH"), PeerEndpoint: os.Getenv("FABRIC_PEER_ENDPOINT"), PeerHostAlias: os.Getenv("FABRIC_PEER_HOST_ALIAS"), Channel: os.Getenv("FABRIC_CHANNEL"), Chaincode: os.Getenv("FABRIC_CHAINCODE")})
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
	r := api.New(service.NewControlTowerService(l, sources...), mode).Router()
	if err := r.Run(net.JoinHostPort(os.Getenv("HOST"), port)); err != nil {
		log.Fatal(err)
	}
}
