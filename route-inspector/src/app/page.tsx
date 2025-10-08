'use client';

import React, { useEffect, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Position,
  MarkerType,
  useEdgesState,
  useNodesState,
  ReactFlowProvider,
  Node,
  OnNodesChange,
  NodeChange,
} from "reactflow";
import "reactflow/dist/style.css";
import html2canvas from "html2canvas";
import styles from './RouteGraph.module.css';

function classifyEndpoint(label: string = "") {
  if (label.startsWith("http-/")) return "local";
  if (label.startsWith("http://") || label.startsWith("https://")) return "external";
  return "middleware";
}

function getColor(type: string) {
  switch (type) {
    case "local": return "#1fb668ff";
    case "external": return "#e5e7eb";
    case "middleware": return "#dbeafe";
    default: return "#ffffff";
  }
}

function isHttpUrl(label: string = "") {
  return label.startsWith("http://") || label.startsWith("https://");
}

async function checkHealth(url: string) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

async function fetchRoutesFromAPI() {
  try {
    const res = await fetch("http://localhost:8080/routes", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("Route list fetch failed");

    const routeNames: string[] = await res.json();

    const routes = await Promise.all(
      routeNames.map(async (name) => {
        try {
          const r = await fetch(`http://localhost:8080/routes/${name}`);
          if (!r.ok) throw new Error(`Route ${name} not found`);
          return await r.json();
        } catch (e) {
          console.warn(`⚠️ Fehler bei Route ${name}:`, e);
          return null;
        }
      })
    );

    return routes.filter((r): r is { name: string; source: string; dest: string; module: string } => r !== null);
  } catch (err) {
    console.error("❌ Fehler beim Laden der Routen:", err);
    return [];
  }
}

function ExportButton({ containerRef }: { containerRef: React.RefObject<HTMLDivElement> }) {
  const handleExport = async () => {
    if (!containerRef.current) return;
    const canvas = await html2canvas(containerRef.current);
    const link = document.createElement('a');
    link.download = 'ecm-route-graph.png';
    link.href = canvas.toDataURL();
    link.click();
  };

  return (
    <button onClick={handleExport} className={styles.downloadButton}>
      Download als Bild
    </button>
  );
}

function Legend() {
  return (
    <div className={styles.legend}>
      <strong>Farblegende:</strong>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
        <div className={styles.legendItem}><span className={styles.colorBox} style={{ backgroundColor: '#d1fae5' }} /> Data Hub Endpoint (http-/)</div>
        <div className={styles.legendItem}><span className={styles.colorBox} style={{ backgroundColor: '#e5e7eb' }} /> external Endpoint (http/https)</div>
        <div className={styles.legendItem}><span className={styles.colorBox} style={{ backgroundColor: '#dbeafe' }} /> Advanced Event Mesh Topic/Queue</div>
      </div>
    </div>
  );
}

function RouteGraphInner() {
  const containerRef = useRef(null);
  const [nodeState, setNodes, _onNodesChange] = useNodesState([]);
  const [edgeState, setEdges, onEdgesChange] = useEdgesState([]);
  const [healthMap, setHealthMap] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  // Positionsänderung + Persistenz
  const onNodesChange: OnNodesChange = (changes: NodeChange[]) => {
    _onNodesChange(changes);

    const newPositions: Record<string, { x: number; y: number }> = {};
    nodeState.forEach((node) => {
      const change = changes.find((c) => c.id === node.id && c.type === 'position');
      if (change && 'position' in change && change.position) {
        newPositions[node.id] = change.position;
      } else {
        newPositions[node.id] = node.position;
      }
    });

    localStorage.setItem("ecm-node-positions", JSON.stringify(newPositions));
  };

  useEffect(() => {
    async function initGraph() {
      const routes = await fetchRoutesFromAPI();
      const { nodes, edges } = buildGraph(routes);

      const saved = JSON.parse(localStorage.getItem("ecm-node-positions") || "{}");
      nodes.forEach((node) => {
        if (saved[node.id]) node.position = saved[node.id];
      });

      const httpNodes = nodes.filter(n => isHttpUrl(n.data.rawLabel));
      const healthChecks = await Promise.all(
        httpNodes.map(async (node) => {
          const status = await checkHealth(node.data.rawLabel);
          return { id: node.id, status };
        })
      );

      const health = Object.fromEntries(healthChecks.map((h) => [h.id, h.status]));
      setHealthMap(health);

      const updatedNodes = nodes.map((node) => {
        const status = health[node.id];
        let border = "1px solid #999";
        if (status === 'up') border = "2px solid #38a169";
        if (status === 'down') border = "2px solid #e53e3e";

        return {
          ...node,
          style: {
            ...node.style,
            border,
            whiteSpace: 'pre-wrap',
            textAlign: 'left',
            lineHeight: 1.2,
          },
          data: {
            ...node.data,
            label: isHttpUrl(node.data.rawLabel)
              ? `${node.data.rawLabel}\n${status === 'up' ? '✅ UP' : status === 'down' ? '❌ DOWN' : '⏳ Checking…'}`
              : node.data.rawLabel,
          },
        };
      });

      setEdges(edges);
      setNodes(updatedNodes);
    }

    initGraph();
  }, [setNodes, setEdges, refreshKey]);

  const resetLayout = () => {
    localStorage.removeItem("ecm-node-positions");
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div>
      <h1 className={styles.title}>Data Hub Route Inspector</h1>
      <Legend />
      <div className={styles.toolbar}>
        <ExportButton containerRef={containerRef} />
        <button onClick={resetLayout} className={styles.resetButton}>
          Positionen zurücksetzen
        </button>
      </div>
      <div ref={containerRef} style={{ width: "100%", height: "80vh", backgroundColor: "#f9fafb" }}>
        <ReactFlow
          nodes={nodeState}
          edges={edgeState}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
        >
          <MiniMap nodeStrokeColor="#2b6cb0" nodeColor="#bee3f8" />
          <Controls />
          <Background color="#e2e8f0" gap={20} />
        </ReactFlow>
      </div>
    </div>
  );
}

function buildGraph(routes: any[]) {
  const nodesMap = new Map<string, string>();
  const edges = [];
  let idCounter = 1;

  function getNodeId(label: string) {
    if (!nodesMap.has(label)) {
      nodesMap.set(label, `${idCounter++}`);
    }
    return nodesMap.get(label)!;
  }

  routes.forEach((route) => {
    const sourceLabel = String(route.source || "");
    const destLabel = String(route.dest || "");

    const sourceId = getNodeId(sourceLabel);
    const destId = getNodeId(destLabel);

    edges.push({
      id: `${sourceId}-${destId}`,
      source: sourceId,
      target: destId,
      label: route.name,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#2b6cb0' },
      labelBgStyle: { fill: '#f0f0f0', color: '#1a202c', fillOpacity: 0.9 },
      labelStyle: { fontWeight: 'bold', fontSize: 10 },
    });
  });

  const nodes = Array.from(nodesMap.entries()).map(([label, id], index) => {
    const type = classifyEndpoint(label);
    const fontSize = label.length > 20 ? 8 : 10;
    return {
      id,
      position: { x: 300 * (index % 3), y: 200 * Math.floor(index / 3) },
      data: { label, rawLabel: label },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {
        border: "1px solid #999",
        padding: 10,
        borderRadius: 8,
        backgroundColor: getColor(type),
        color: "#1a202c",
        fontSize,
        maxWidth: 200,
        whiteSpace: "normal",
        overflowWrap: "break-word",
        wordBreak: "break-word",
      },
    };
  });

  return { nodes, edges };
}

export default function RouteGraph() {
  return (
    <ReactFlowProvider>
      <RouteGraphInner />
    </ReactFlowProvider>
  );
}