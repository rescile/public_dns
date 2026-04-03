# Hybrid DNS

A hybrid DNS configuration combines globally distributed, anycast-based authoritative DNS nodes with on-premises authoritative DNS servers integrated into the same zone authority, to deliver resilient, low-latency, and sovereign DNS resolution. The hybrid DNS model functions by decoupling the **control plane**—where zone management, policy enforcement, and record updates are centralized—from a highly resilient **data plane**. This data plane utilizes a multi-tier authoritative structure where a globally distributed anycast edge layer handles massive query volumes and absorbs DDoS attacks, while an on-premises layer provides ultra-low latency and sovereign control for local infrastructure. By maintaining a **shared zone authority**, both the cloud and on-prem tiers serve as the source of truth for the same zones, ensuring data consistency across all endpoints via synchronized transfer protocols like AXFR/IXFR or automated API-driven pipelines.


```mermaid
flowchart
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
CP -->|Zone Updates| E1
CP -->|Zone Updates| E2
CP -->|Zone Updates| E3
CP -->|AXFR / IXFR| P1
P1 -->|Zone Transfer| P2

%% Client Resolution Path
C -->|DNS Query| E1
C -->|DNS Query| E2
C -->|DNS Query| E3
C -->|DNS Query| P1
C -->|DNS Query| P2

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

### Resilience through Redundancy
The hybrid setup eliminates the single-provider dependency when moving a public DNS resolver to a CDN provider. Integrating Anycast with on-premises bind instances prohibits a "single point of failure" inherent in relying solely on a cloud provider or a single data center and inherits operational souvereignty. In a DDoS attack, Anycast Protection spreads the load across dozens of global nodes, effectively "absorbing" the traffic. If the global provider suffers a massive routing leak or a regional fiber cut, on-premises Fallback nodes continue to serve local traffic. This ensures that internal operations remain functional even if the "outside world" is struggling.

### Comparision

| Feature | Global Anycast Only | On-Premises Only | Hybrid Integration |
| :--- | :--- | :--- | :--- |
| **DDoS Mitigation** | Excellent (Global absorption) | Poor (Limited by pipe size) | **Superior (Multi-layered)** |
| **Local Latency** | Low (30–50ms) | Ultra-Low (<5ms) | **Optimal (Best-path routing)** |
| **Data Sovereignty** | Third-party dependent | Full Control | **Controlled Exposure** |
| **Control Plane** | Centralized/Cloud-native | Localized | **Unified Management** |
| **Operational Risk** | Provider-dependent | Hardware-dependent | **Distributed/Redundant** |
| **Implementation** | Simple | Moderate | **Complex** |

### Low Latency
Speed in DNS is determined by the "Physical Distance" between the recursive resolver and the authoritative server. In a hybrid setup, the Anycast edge handles most queries close to clients, while local instances serve local systems. For internet users, an Anycast node in a nearby Point of Presence (POP) ensures sub-30ms resolution. For local infrastructure inside a data center or a private cloud, an on-premises authoritative server provides near-zero latency. By placing the server on the same LAN or high-speed backbone as the applications it serves, systems bypass the "cold start" delays often found in public internet routing.

### Digital Sovereignty and Compliance
In an era of increasing data localization laws like GDPR or specialized financial regulations, where the data "lives" matters. Some organizations are legally or strategically required to retain authoritative capability and remain in control over critical data. The hybrid DNS setup allows operators to keep their "Master" zone files on hardware they physically own and to serve sensitive internal records strictly from on-premises nodes while using the global Anycast network to serve only public-facing records. This prevents internal network topography from being cached or analyzed by third-party global providers.

### Operational Consistency and Simplified Troubleshooting
Integrating multiple instance into the same zone authority rather than having separate internal and external views simplifies management. Maintaining a single zone authority makes it easier to manage DNSSEC signing keys. Operators don't have to worry about desynchronization between "Internal" and "External" views that often lead to validation failures. Engineers don't have to guess which "version" of a record is being hit. The hybrid approach ensures that whether a query hits a cloud node or a local server, the answer is cryptographically identical and consistent. 

### Additional Properties
* **Operational flexibility**: Independent scaling of cloud and on-prem layers
* **Failover symmetry**: Either layer can serve the full zone if the other fails
* **Alternative Naming Options (Vendor-neutral)**

## Contributing & Rules of Engagement

We love community input! Whether you're fixing a bug, improving documentation, or suggesting a new feature, your contributions help make this project better for everyone. To keep things running smoothly, please follow these guidelines:

* **Check for Issues:** Before starting work, please check the [Issues](link-to-your-issues) tab to see if someone else is already tackling the task or to open a new discussion.
* **Branching Strategy:** Please submit all pull requests (PRs) against the `develop` branch rather than `main`.
* **Atomic Commits:** Keep your PRs focused. It’s much easier to review three small, specific PRs than one giant "fix-everything" update.
* **Code of Conduct:** Be kind and respectful to fellow contributors. We’re all here to learn and build cool things together.
* **Stay in Touch:** If you’re planning a major architectural change, please open a "RFC" (Request for Comments) issue first so we can align on the direction.

**Ready to jump in?** Fork the repo, make your changes, and send over a PR. We can't wait to see what you build!
