package main

import (
	"fmt"
	"log"
	"os"

	"github.com/Viper3-yu/fabric/apps/api/internal/config"
	"github.com/Viper3-yu/fabric/apps/api/internal/ledger"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if cfg.LedgerMode != "demo" {
		log.Fatal("The seed command only writes the explicitly marked demo ledger")
	}
	store, err := ledger.NewDemo(cfg.DemoLedgerPath)
	if err != nil {
		log.Fatal(err)
	}
	force := false
	for _, argument := range os.Args[1:] {
		if argument == "--force" {
			force = true
		}
	}
	seeded, count, err := ledger.SeedDemo(store, force)
	if err != nil {
		log.Fatal(err)
	}
	if seeded {
		fmt.Printf("[jixin-api] seeded %d demo shipments at %s\n", count, cfg.DemoLedgerPath)
		return
	}
	fmt.Printf("[jixin-api] demo ledger already contains %d shipments; no changes made\n", count)
}
