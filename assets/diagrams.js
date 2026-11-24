const DIAGRAMS = {};

DIAGRAMS['LOCAL_DEV'] = `
<div class="aws-diagram" id="local-dev-diagram">
  <div class="aws-diagram-title">로컬 개발 구성도</div>
  <div class="ldev-stage">
    <svg class="ldev-svg" width="680" height="420" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arr-gray" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#64748b"/>
        </marker>
        <marker id="arr-pg" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#4169E1"/>
        </marker>
        <marker id="arr-minio" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#C72E28"/>
        </marker>
        <marker id="arr-nas" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#7AA116"/>
        </marker>
      </defs>
      <line x1="140" y1="205" x2="218" y2="205" stroke="#64748b" stroke-width="2" marker-end="url(#arr-gray)"/>
      <text x="179" y="197" font-size="10" fill="#94a3b8" text-anchor="middle" font-family="sans-serif">HTTP</text>
      <line x1="366" y1="190" x2="450" y2="72" stroke="#4169E1" stroke-width="2" marker-end="url(#arr-pg)"/>
      <line x1="366" y1="205" x2="450" y2="205" stroke="#C72E28" stroke-width="2" stroke-dasharray="5,3" marker-end="url(#arr-minio)"/>
      <text x="408" y="197" font-size="10" fill="#C72E28" text-anchor="middle" font-family="sans-serif">파일 업로드 테스트</text>
      <line x1="366" y1="220" x2="450" y2="336" stroke="#7AA116" stroke-width="2" stroke-dasharray="5,3" marker-end="url(#arr-nas)"/>
      <text x="420" y="295" font-size="10" fill="#7AA116" text-anchor="middle" font-family="sans-serif">LAN 직접</text>
    </svg>
    <div class="ldev-node-pos" style="left:8px;top:150px">
      <div class="aws-node compute" style="width:130px">
        <div class="aws-icon" style="background:#042B59">
          <img src="https://cdn.simpleicons.org/flutter/54C5F8" width="26" height="26" alt="Flutter">
        </div>
        <div class="aws-name">Flutter 앱</div>
        <div class="aws-sub">iOS Simulator</div>
      </div>
    </div>
    <div class="ldev-node-pos" style="left:218px;top:150px">
      <div class="aws-node compute" style="width:148px">
        <div class="aws-icon" style="background:#1A3D1E">
          <img src="https://cdn.simpleicons.org/springboot/6DB33F" width="26" height="26" alt="Spring Boot">
        </div>
        <div class="aws-name">Spring Boot</div>
        <div class="aws-sub">JVM 직접 실행 · :8081</div>
      </div>
    </div>
    <div class="ldev-node-pos" style="left:452px;top:16px">
      <div class="aws-node database" style="width:130px">
        <div class="aws-icon" style="background:#1A2F4A">
          <img src="https://cdn.simpleicons.org/postgresql/4169E1" width="26" height="26" alt="PostgreSQL">
        </div>
        <div class="aws-name">PostgreSQL</div>
        <div class="aws-sub">docker · :5433</div>
      </div>
    </div>
    <div class="ldev-node-pos" style="left:452px;top:150px">
      <div class="aws-node storage optional" style="width:130px">
        <div class="aws-icon" style="background:#3D0E0C">
          <img src="https://cdn.simpleicons.org/minio/C72E28" width="26" height="26" alt="MinIO">
        </div>
        <div class="aws-name">MinIO</div>
        <div class="aws-sub">docker · :9000 선택</div>
      </div>
    </div>
    <div class="ldev-node-pos" style="left:452px;top:284px">
      <div class="aws-node storage optional" style="width:130px">
        <div class="aws-icon" style="background:#1E2A06">
          <img src="https://cdn.simpleicons.org/minio/7AA116" width="26" height="26" alt="NAS MinIO">
        </div>
        <div class="aws-name">NAS MinIO</div>
        <div class="aws-sub">LAN · :9000 선택</div>
      </div>
    </div>
  </div>
  <div class="aws-legend">
    <span class="legend-item compute">Compute</span>
    <span class="legend-item database">Database</span>
    <span class="legend-item storage">Storage</span>
    <span style="font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:4px">
      <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#94a3b8" stroke-width="2" stroke-dasharray="4,2"/></svg>
      선택적 연결
    </span>
  </div>
</div>`;

DIAGRAMS['PROD'] = `
<div class="aws-diagram" id="prod-diagram">
  <div class="aws-diagram-title">운영 구성도</div>
  <div class="aws-prod-canvas">
    <div class="aws-prod-row">
      <div class="aws-node network" style="width:130px">
        <div class="aws-icon" style="background:#1e3a5f">
          <img src="https://cdn.simpleicons.org/internetexplorer/4dabf7" width="26" height="26" alt="Internet" onerror="this.parentElement.textContent='🌐'">
        </div>
        <div class="aws-name">인터넷 사용자</div>
      </div>
      <div class="aws-harrow">
        <span>HTTPS</span>
        <svg width="60" height="20"><line x1="0" y1="10" x2="50" y2="10" stroke="#94a3b8" stroke-width="2"/><polygon points="50,6 60,10 50,14" fill="#94a3b8"/></svg>
      </div>
      <div class="aws-node network" style="width:150px">
        <div class="aws-icon" style="background:#3D1F00">
          <img src="https://cdn.simpleicons.org/cloudflare/F38020" width="26" height="26" alt="Cloudflare">
        </div>
        <div class="aws-name">Cloudflare 엣지</div>
        <div class="aws-sub">TLS · DDoS · WAF</div>
      </div>
      <div class="aws-harrow">
        <span>Tunnel</span>
        <svg width="60" height="20"><line x1="0" y1="10" x2="50" y2="10" stroke="#94a3b8" stroke-width="2" stroke-dasharray="4,2"/><polygon points="50,6 60,10 50,14" fill="#94a3b8"/></svg>
      </div>
      <div class="aws-group prod-host" style="flex:1">
        <div class="aws-group-label">🖥 맥미니 · OrbStack</div>
        <div class="aws-prod-inner-row">
          <div class="aws-node network" style="width:120px">
            <div class="aws-icon" style="background:#042040">
              <img src="https://cdn.simpleicons.org/kamal/0ea5e9" width="26" height="26" alt="kamal" onerror="this.parentElement.innerHTML='🔀'">
            </div>
            <div class="aws-name">kamal-proxy</div>
            <div class="aws-sub">:80 Blue/Green</div>
          </div>
          <div class="aws-harrow small">
            <svg width="40" height="20"><line x1="0" y1="10" x2="30" y2="10" stroke="#94a3b8" stroke-width="2"/><polygon points="30,6 40,10 30,14" fill="#94a3b8"/></svg>
          </div>
          <div class="aws-node compute" style="width:140px">
            <div class="aws-icon" style="background:#1A3D1E">
              <img src="https://cdn.simpleicons.org/springboot/6DB33F" width="26" height="26" alt="Spring Boot">
            </div>
            <div class="aws-name">Spring Boot</div>
            <div class="aws-sub">container :8080</div>
          </div>
        </div>
        <div class="aws-group obs-group" style="margin-top:16px">
          <div class="aws-group-label">📊 관측성 스택 (docker-compose)</div>
          <div class="aws-row" style="gap:8px">
            <div class="aws-node obs mini"><div class="aws-icon sm" style="background:#3D1200"><img src="https://cdn.simpleicons.org/prometheus/E6522C" width="20" height="20" alt="Prometheus"></div><div class="aws-name sm">Prometheus<br/>:9090</div></div>
            <div class="aws-node obs mini"><div class="aws-icon sm" style="background:#1A1A2E"><img src="https://cdn.simpleicons.org/grafana/F5A623" width="20" height="20" alt="Loki"></div><div class="aws-name sm">Loki<br/>:3100</div></div>
            <div class="aws-node obs mini"><div class="aws-icon sm" style="background:#2A1800"><img src="https://cdn.simpleicons.org/grafana/F46800" width="20" height="20" alt="Grafana"></div><div class="aws-name sm">Grafana<br/>:3000</div></div>
            <div class="aws-node obs mini"><div class="aws-icon sm" style="background:#2A001A"><img src="https://cdn.simpleicons.org/prometheus/E01E5A" width="20" height="20" alt="Alertmanager"></div><div class="aws-name sm">Alertmanager<br/>:9093</div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="aws-prod-row ext-row">
      <div style="flex:1"></div>
      <div class="aws-ext-connectors">
        <div class="aws-ext-item">
          <div class="aws-varrow">
            <svg width="20" height="40"><line x1="10" y1="0" x2="10" y2="30" stroke="#94a3b8" stroke-width="2"/><polygon points="6,30 14,30 10,40" fill="#94a3b8"/></svg>
            <span>JDBC :6543</span>
          </div>
          <div class="aws-node database" style="width:130px">
            <div class="aws-icon" style="background:#0D2918">
              <img src="https://cdn.simpleicons.org/supabase/3ECF8E" width="26" height="26" alt="Supabase">
            </div>
            <div class="aws-name">Supabase Seoul</div>
            <div class="aws-sub">PostgreSQL</div>
          </div>
        </div>
        <div class="aws-ext-item">
          <div class="aws-varrow">
            <svg width="20" height="40"><line x1="10" y1="0" x2="10" y2="30" stroke="#94a3b8" stroke-width="2"/><polygon points="6,30 14,30 10,40" fill="#94a3b8"/></svg>
            <span>S3 API</span>
          </div>
          <div class="aws-node storage" style="width:130px">
            <div class="aws-icon" style="background:#1E2A06">
              <img src="https://cdn.simpleicons.org/minio/7AA116" width="26" height="26" alt="MinIO">
            </div>
            <div class="aws-name">NAS MinIO</div>
            <div class="aws-sub">Tailscale LAN</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="aws-legend">
    <span class="legend-item compute">Compute</span>
    <span class="legend-item database">Database</span>
    <span class="legend-item storage">Storage</span>
    <span class="legend-item network">Network</span>
    <span class="legend-item obs">Observability</span>
  </div>
</div>`;
