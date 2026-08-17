package ledger

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Viper3-yu/fabric/apps/api/internal/apperror"
	"github.com/Viper3-yu/fabric/apps/api/internal/config"
)

// writeTestIdentity writes a self-signed certificate and EC private key and
// returns their paths. grpc.NewClient and client.Connect are lazy (no dial
// happens until an RPC runs), so the cache behaviour is testable without a
// live peer.
func writeTestIdentity(t *testing.T, dir, name string) (certPath, keyPath string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		IsCA:         true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})

	certPath = filepath.Join(dir, name+".pem")
	keyPath = filepath.Join(dir, name+".key")
	if err := os.WriteFile(certPath, certPEM, 0o600); err != nil {
		t.Fatalf("write cert: %v", err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}
	return certPath, keyPath
}

func newTestFabric(t *testing.T) *Fabric {
	t.Helper()
	dir := t.TempDir()
	org1Cert, org1Key := writeTestIdentity(t, dir, "org1")
	org2Cert, org2Key := writeTestIdentity(t, dir, "org2")
	fabric, err := NewFabric(config.FabricConfig{
		ChannelName:   "logisticschannel",
		ChaincodeName: "logistics",
		Org1: config.OrgConfig{
			MSPID: "Org1MSP", CertPath: org1Cert, KeyPath: org1Key,
			PeerEndpoint: "127.0.0.1:7051", PeerHostAlias: "peer0.org1.example.com",
			TLSCertPath: org1Cert,
		},
		Org2: config.OrgConfig{
			MSPID: "Org2MSP", CertPath: org2Cert, KeyPath: org2Key,
			PeerEndpoint: "127.0.0.1:9051", PeerHostAlias: "peer0.org2.example.com",
			TLSCertPath: org2Cert,
		},
	})
	if err != nil {
		t.Fatalf("new fabric: %v", err)
	}
	return fabric
}

func TestFabricConnectionCachedPerOrganization(t *testing.T) {
	fabric := newTestFabric(t)
	defer fabric.Close()

	first, err := fabric.connectionFor(fabric.config.Org1)
	if err != nil {
		t.Fatalf("first connection: %v", err)
	}
	second, err := fabric.connectionFor(fabric.config.Org1)
	if err != nil {
		t.Fatalf("second connection: %v", err)
	}
	if first.connection != second.connection {
		t.Fatal("expected the same gRPC connection to be reused for one organization")
	}
	if first.gateway != second.gateway {
		t.Fatal("expected the same gateway to be reused for one organization")
	}

	// The cache must hold the parsed identity and TLS material in memory:
	// removing the files from disk must not break subsequent requests.
	if err := os.Remove(fabric.config.Org1.CertPath); err != nil {
		t.Fatalf("remove org1 cert: %v", err)
	}
	if err := os.Remove(fabric.config.Org1.KeyPath); err != nil {
		t.Fatalf("remove org1 key: %v", err)
	}
	third, err := fabric.connectionFor(fabric.config.Org1)
	if err != nil {
		t.Fatalf("cached connection after cert removal: %v", err)
	}
	if third.connection != first.connection {
		t.Fatal("cache hit after cert removal must return the original connection")
	}

	// The other organization gets its own connection.
	org2, err := fabric.connectionFor(fabric.config.Org2)
	if err != nil {
		t.Fatalf("org2 connection: %v", err)
	}
	if org2.connection == first.connection {
		t.Fatal("each organization must have its own gRPC connection")
	}
}

func TestFabricCloseIsIdempotentAndBlocksNewConnections(t *testing.T) {
	fabric := newTestFabric(t)
	if _, err := fabric.connectionFor(fabric.config.Org1); err != nil {
		t.Fatalf("initial connection: %v", err)
	}
	if err := fabric.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if err := fabric.Close(); err != nil {
		t.Fatalf("second close must be a no-op: %v", err)
	}
	_, err := fabric.connectionFor(fabric.config.Org1)
	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != "FABRIC_CLOSED" {
		t.Fatalf("connection after close = %v, want FABRIC_CLOSED", err)
	}
}
