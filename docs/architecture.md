# System Architecture

```mermaid
flowchart TD
    subgraph AGENT["External AI Agent (Developer's Code)"]
        A[Agent Runtime]
    end

    subgraph GATEWAY["Interceptor — Docker / AWS ECS"]
        B[Reverse Proxy\nFastAPI :8000]
        C[Auth Middleware\nBearer Token → Supabase]
        D[Request Buffer\nCapture payload + headers]
        E[Response Buffer\nCapture upstream response]
    end

    subgraph UPSTREAM["Target Data Provider"]
        F[Web Service / API]
    end

    subgraph VERIFICATION["Verification Engine — Python / FastAPI"]
        G[Telemetry Analyzer\nPayload + Response]
        H[Hallucination Detector\nMock → Real Model]
        I[Context Rot Checker\nSession coherence score]
        J[Loop Detector\nRequest dedup fingerprinting]
        K{Proof-of-Execution\nBoolean verdict}
    end

    subgraph LEDGER["Supabase — Postgres"]
        L[(agent_sessions)]
        M[(micro_transactions)]
        N[(api_endpoints)]
        O[(data_providers)]
        P[(agent_developers)]
    end

    subgraph DASHBOARD["Developer Dashboard — Vercel / Next.js"]
        Q[Spend Monitor]
        R[Success Rate Charts]
        S[Pricing Config]
        T[Webhook Alerts]
    end

    A -->|"POST /proxy\nBearer: <token>"| B
    B --> C
    C -->|"validate token"| L
    C -->|"auth fail → 401"| A
    C --> D
    D -->|"forward request"| F
    F -->|"upstream response"| E
    E -->|"telemetry bundle"| G
    G --> H
    G --> I
    G --> J
    H --> K
    I --> K
    J --> K
    K -->|"True: write invoice"| M
    K -->|"False: log failure"| L
    M --> Q
    L --> R
    N --> S
    O --> S
    P --> T
    Q --> A
    R --> A
```

## Data Flow Summary

| Step | Component | Action |
|------|-----------|--------|
| 1 | Agent | Sends HTTP request with Bearer token to Gateway |
| 2 | Interceptor | Validates token against `agent_sessions` in Supabase |
| 3 | Interceptor | Buffers request payload, forwards to target URL |
| 4 | Interceptor | Captures upstream response, bundles telemetry |
| 5 | Verification Engine | Runs hallucination + context rot + loop detection |
| 6 | Verification Engine | Emits `proof_of_execution: bool` verdict |
| 7 | Ledger | On `True`: writes `micro_transactions` row, debits developer wallet |
| 8 | Ledger | On `False`: updates session failure count, no charge |
| 9 | Dashboard | Streams spend, success rates, and alerts in real time |
