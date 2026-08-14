package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Viper3-yu/fabric/apps/api/internal/config"
	"github.com/Viper3-yu/fabric/apps/api/internal/httpapi"
	"github.com/Viper3-yu/fabric/apps/api/internal/ledger"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	store, err := createLedger(cfg)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{
		Addr:              cfg.Host + ":" + fmt.Sprint(cfg.Port),
		Handler:           httpapi.New(cfg, store),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		// Fabric commits can legally wait up to ~80s (endorse+submit+commit
		// status); keep the write window above that so slow commits return a
		// proper error instead of a truncated response.
		WriteTimeout: 100 * time.Second,
		IdleTimeout:  2 * time.Minute,
	}

	go func() {
		log.Printf(
			"[jixin-api] listening on http://%s ledger=%s%s",
			server.Addr,
			store.Mode(),
			map[bool]string{true: " (DEMO LEDGER — NOT REAL BLOCKCHAIN PROOF)", false: ""}[store.Mode() == "demo"],
		)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve API: %v", err)
		}
	}()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	signalName := <-signals
	log.Printf("[jixin-api] %s received, closing server", signalName)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func createLedger(cfg config.Config) (ledger.Ledger, error) {
	if cfg.LedgerMode == "fabric" {
		return ledger.NewFabric(cfg.Fabric)
	}
	store, err := ledger.NewDemo(cfg.DemoLedgerPath)
	if err != nil {
		return nil, err
	}
	if cfg.DemoAutoSeed {
		if _, _, err := ledger.SeedDemo(store, false); err != nil {
			return nil, err
		}
	}
	return store, nil
}
