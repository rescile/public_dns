# Dual-plane DNS (cloud-edge + on-prem authoritative)

A hybrid DNS configurationcombines globally distributed, anycast-based authoritative DNS nodes (cloud-hosted) wuth on-premises authoritative DNS servers (e.g., BIND) integrated into the same zone authority, to deliver resilient, low-latency, and sovereign DNS resolution.

## Multi-tier authoritative DNS

A globally distributed edge layer provides anycast routing for low-latency resolution and high DDoS absorption capacity, while the on-premises layer provides local control over zone data and integration with internal systems and governance controls

## Shared zone authority (multi-provider DNS)

Both cloud and on-prem servers are authoritative for the same zones. Zone data is synchronized via AXFR/IXFR transfers, or API-driven propagation pipelines

```mermaid
graph dns
%% Clients
C[Internet Clients]

%% Anycast / Cloud Edge Layer
subgraph EDGE["Global Anycast DNS Layer"]
    E1[Anycast DNS Node 1]
    E2[Anycast DNS Node 2]
    E3[Anycast DNS Node N]
end

%% On-Prem Layer
subgraph ONPREM["On-Prem Authoritative DNS"]
    P1[Primary DNS]
    P2[Secondary DNS]
end

%% Control Plane
subgraph CONTROL["DNS Control Plane"]
    CP[Zone Management / API / CI-CD Pipeline]
end

%% Zone Distribution
CP -->|Zone Updates | E1
CP -->|Zone Updates | E2
CP -->|Zone Updates | E3
CP -->|AXFR / IXFR| P1
P1 -->|Zone Transfer| P2

%% Client Resolution Path
C -->|DNS Query| E1
C -->|DNS Query| E2
C -->|DNS Query| E3
C -->|DNS Query | P1
C -->|DNS Query | P2

%% Logical Relationship
E1 -. Authoritative for Zone .- P1
E2 -. Authoritative for Zone .- P1
E3 -. Authoritative for Zone .- P2

%% Styling
classDef edge fill:#1f77b4,stroke:#333,stroke-width:1px,color:#fff;
classDef onprem fill:#2ca02c,stroke:#333,stroke-width:1px,color:#fff;
classDef control fill:#9467bd,stroke:#333,stroke-width:1px,color:#fff;

class E1,E2,E3 edge;
class P1,P2 onprem;
class CP control;
```

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
