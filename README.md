# Dual-plane DNS (cloud-edge + on-prem authoritative)

A hybrid DNS configurationcombines globally distributed, anycast-based authoritative DNS nodes (cloud-hosted) wuth on-premises authoritative DNS servers (e.g., BIND) integrated into the same zone authority, to deliver resilient, low-latency, and sovereign DNS resolution.

## Multi-tier authoritative DNS

A globally distributed edge layer provides anycast routing for low-latency resolution and high DDoS absorption capacity, while the on-premises layer provides local control over zone data and integration with internal systems and governance controls

## Shared zone authority (multi-provider DNS)

Both cloud and on-prem servers are authoritative for the same zones. Zone data is synchronized via AXFR/IXFR transfers, or API-driven propagation pipelines

## Control plane vs. data plane separation

* **Control plane**: zone management, updates, policy enforcement (can be centralized or dual-managed)
* **Data plane**: distributed query answering across cloud and on-prem endpoints

## Key Properties
* **Resilience**: Eliminates single-provider dependency (provider-level fault isolation)
* **Latency optimization**: Anycast edge handles most queries close to clients
* **Data sovereignty / compliance**: On-prem nodes retain authoritative capability
* **Operational flexibility**: Independent scaling of cloud and on-prem layers
* **Failover symmetry**: Either layer can serve the full zone if the other fails
* **Alternative Naming Options (Vendor-neutral)**
