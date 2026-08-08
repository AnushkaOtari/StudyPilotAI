import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  ReactFlow, 
  Controls, 
  Background, 
  applyNodeChanges, 
  applyEdgeChanges,
  Handle,
  Position
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { ArrowLeft, RefreshCw, X, Network } from 'lucide-react';
import api from '../services/api';
import './MindMapPage.css';

// ----------------------------------------
// Custom Node Components
// ----------------------------------------

const RootNode = ({ data }) => (
  <div className="node-base node-root" onClick={() => data.onNodeClick(data.details)}>
    <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    {data.label}
  </div>
);

const MainTopicNode = ({ data }) => (
  <div className="node-base node-main" onClick={() => data.onNodeClick(data.details)}>
    <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    {data.label}
  </div>
);

const SubTopicNode = ({ data }) => (
  <div className="node-base node-sub" onClick={() => data.onNodeClick(data.details)}>
    <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    {data.label}
  </div>
);

const nodeTypes = {
  rootNode: RootNode,
  mainTopicNode: MainTopicNode,
  subTopicNode: SubTopicNode,
};

// ----------------------------------------
// Auto Layout Helper (Dagre)
// ----------------------------------------

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction, ranksep: 100, nodesep: 50 });

  nodes.forEach((node) => {
    // approximate dimensions based on CSS max-width and padding
    dagreGraph.setNode(node.id, { width: 200, height: 80 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.targetPosition = isHorizontal ? 'left' : 'top';
    node.sourcePosition = isHorizontal ? 'right' : 'bottom';
    
    // Shift center to top left for react flow
    node.position = {
      x: nodeWithPosition.x - 200 / 2,
      y: nodeWithPosition.y - 80 / 2,
    };
    return node;
  });

  return { nodes, edges };
};

export default function MindMapPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const chatId = location.state?.chatId;

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMindMap, setHasMindMap] = useState(false);
  
  // Drawer state
  const [selectedNodeDetails, setSelectedNodeDetails] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ----------------------------------------
  // Handlers
  // ----------------------------------------

  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const handleNodeClick = useCallback((details) => {
    setSelectedNodeDetails(details);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = () => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedNodeDetails(null), 300);
  };

  // ----------------------------------------
  // Data Transformation
  // ----------------------------------------

  const transformJsonToElements = useCallback((mindmapData) => {
    const rawNodes = [];
    const rawEdges = [];
    
    let idCounter = 1;

    const traverse = (nodeData, parentId = null, depth = 0) => {
      const currentId = `node-${idCounter++}`;
      
      let type = 'subTopicNode';
      if (depth === 0) type = 'rootNode';
      else if (depth === 1) type = 'mainTopicNode';

      rawNodes.push({
        id: currentId,
        type: type,
        data: { 
          label: nodeData.title,
          details: {
            title: nodeData.title,
            summary: nodeData.summary,
            key_points: nodeData.key_points || [],
            related_concepts: nodeData.related_concepts || []
          },
          onNodeClick: handleNodeClick
        },
        position: { x: 0, y: 0 }, // Will be set by dagre
      });

      if (parentId) {
        rawEdges.push({
          id: `edge-${parentId}-${currentId}`,
          source: parentId,
          target: currentId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#94a3b8', strokeWidth: 2 }
        });
      }

      if (nodeData.children && Array.isArray(nodeData.children)) {
        nodeData.children.forEach(child => traverse(child, currentId, depth + 1));
      }
    };

    if (mindmapData && mindmapData.root) {
      traverse(mindmapData.root);
    }
    
    // Apply layout
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges, 'TB');
    
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [handleNodeClick]);

  // ----------------------------------------
  // API Calls
  // ----------------------------------------

  const fetchMindMap = useCallback(async () => {
    if (!chatId) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError('');
    try {
      const response = await api.get(`/mindmap/${chatId}`);
      if (response.data.error) {
        setError(response.data.error);
        setHasMindMap(false);
      } else if (response.data.mindmap === null || !response.data.root) {
        setHasMindMap(false);
      } else {
        transformJsonToElements(response.data);
        setHasMindMap(true);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to fetch mind map.');
    } finally {
      setLoading(false);
    }
  }, [chatId, transformJsonToElements]);

  useEffect(() => {
    fetchMindMap();
  }, [fetchMindMap]);

  const generateMindMap = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/mindmap/generate', { chat_id: chatId });
      if (response.data.error) {
        setError(response.data.error);
      } else {
        transformJsonToElements(response.data);
        setHasMindMap(true);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to generate mind map.');
    } finally {
      setLoading(false);
    }
  };

  const regenerateMindMap = async () => {
    setLoading(true);
    setError('');
    setDrawerOpen(false);
    try {
      const response = await api.post('/mindmap/regenerate', { chat_id: chatId });
      if (response.data.error) {
        setError(response.data.error);
      } else {
        transformJsonToElements(response.data);
        setHasMindMap(true);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to regenerate mind map.');
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------------
  // Render
  // ----------------------------------------

  if (!chatId) {
    return (
      <div className="mindmap-page">
        <div className="mindmap-header">
          <button className="mindmap-back-btn" onClick={() => navigate('/chat')}>
            <ArrowLeft size={18} /> Back to Chat
          </button>
        </div>
        <div className="mindmap-container">
          <div className="mindmap-empty-state">
            <Network size={40} color="#cbd5e1" />
            <h2>No Chat Selected</h2>
            <p>Please select or create a chat first to use the AI Mind Map feature.</p>
            <button className="mindmap-btn-primary" onClick={() => navigate('/chat')}>
              Go to Chats
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mindmap-page">
      <div className="mindmap-header">
        <div className="mindmap-header-title">
          <button className="mindmap-back-btn" onClick={() => navigate('/chat')}>
            <ArrowLeft size={18} /> Back
          </button>
          <h1>AI Mind Map</h1>
        </div>
        
        {hasMindMap && !loading && (
          <div className="mindmap-actions">
            <button className="mindmap-btn-primary" onClick={regenerateMindMap}>
              <RefreshCw size={16} /> Regenerate
            </button>
          </div>
        )}
      </div>

      <div className="mindmap-container">
        {loading && (
          <div className="loader-container">
            <div className="loader-spinner"></div>
            <div className="loader-text">Analyzing your notes...</div>
          </div>
        )}

        {!loading && !hasMindMap && (
          <div className="mindmap-empty-state">
            <Network size={40} color="#cbd5e1" />
            <h2>Visualize Your Notes</h2>
            <p>Generate a structured, interactive mind map from your uploaded study materials.</p>
            <button className="mindmap-btn-primary" onClick={generateMindMap} disabled={loading}>
              <Network size={18} /> Generate Mind Map
            </button>
            {error && <div className="error-message">{error}</div>}
          </div>
        )}

        {hasMindMap && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
            minZoom={0.2}
          >
            <Background color="#cbd5e1" gap={20} size={1} />
            <Controls />
          </ReactFlow>
        )}

        {/* Details Drawer */}
        <div className={`mindmap-drawer ${drawerOpen ? 'open' : ''}`}>
          <div className="drawer-header">
            <h2>{selectedNodeDetails?.title || 'Details'}</h2>
            <button className="close-drawer-btn" onClick={closeDrawer}>
              <X size={20} />
            </button>
          </div>
          <div className="drawer-content">
            {selectedNodeDetails && (
              <>
                <div className="drawer-section">
                  <h3>Summary</h3>
                  <p>{selectedNodeDetails.summary}</p>
                </div>
                
                {selectedNodeDetails.key_points?.length > 0 && (
                  <div className="drawer-section">
                    <h3>Key Points</h3>
                    <ul>
                      {selectedNodeDetails.key_points.map((point, i) => (
                        <li key={i}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedNodeDetails.related_concepts?.length > 0 && (
                  <div className="drawer-section">
                    <h3>Related Concepts</h3>
                    <div>
                      {selectedNodeDetails.related_concepts.map((concept, i) => (
                        <span key={i} className="related-tag">{concept}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
