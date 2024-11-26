import logging
from typing import Dict, List, Optional, Tuple
import networkx as nx
from dataclasses import dataclass
import json
from datetime import datetime

@dataclass
class SubQuery:
    id: str
    text: str
    dependencies: List[str]
    tools_required: List[str]
    status: str = "pending"
    result: Optional[str] = None

@dataclass
class ReasoningStep:
    step_id: str
    timestamp: datetime
    action: str
    details: Dict
    status: str

class QueryDecomposer:
    def __init__(self, ollama_endpoint: str, logger=None):
        """Initialize QueryDecomposer with Ollama endpoint and optional logger."""
        self.ollama_endpoint = ollama_endpoint
        self.logger = logger or logging.getLogger(__name__)
        self.dependency_graph = nx.DiGraph()
        self.reasoning_steps = []
        self.available_tools = self._load_available_tools()

    def _load_available_tools(self) -> Dict:
        """Load available tools from Ollama configuration."""
        return {
            "web_search": {
                "name": "web_search",
                "description": "Search the web for information",
                "parameters": {"query": "string"}
            },
            "academic_search": {
                "name": "academic_search",
                "description": "Search academic papers and journals",
                "parameters": {"query": "string"}
            },
            "calculator": {
                "name": "calculator",
                "description": "Perform mathematical calculations",
                "parameters": {"expression": "string"}
            }
        }

    async def decompose_query(self, query: str) -> List[SubQuery]:
        """Decompose complex query into sub-queries using Ollama's tool feature."""
        try:
            # Log decomposition start
            self._track_step("decomposition_start", {"query": query})

            # Call Ollama API to analyze query and suggest decomposition
            decomposition_prompt = {
                "model": "llama2",
                "messages": [{
                    "role": "system",
                    "content": "Analyze the query and break it down into logical sub-queries. Consider dependencies and required tools."
                }, {
                    "role": "user",
                    "content": query
                }],
                "tools": list(self.available_tools.values())
            }

            # Make API call to Ollama
            response = await self._call_ollama_api(decomposition_prompt)
            sub_queries = self._parse_decomposition_response(response)

            # Create dependency graph
            self.create_dependency_graph(sub_queries)

            # Log successful decomposition
            self._track_step("decomposition_complete", {
                "sub_queries": len(sub_queries),
                "dependencies": len(self.dependency_graph.edges)
            })

            return sub_queries

        except Exception as e:
            self._track_step("decomposition_error", {"error": str(e)})
            raise

    async def _call_ollama_api(self, prompt: Dict) -> Dict:
        """Make API call to Ollama endpoint."""
        # Implementation of API call to Ollama
        # This would use appropriate HTTP client library
        pass

    def _parse_decomposition_response(self, response: Dict) -> List[SubQuery]:
        """Parse Ollama's response into structured SubQuery objects."""
        sub_queries = []
        for idx, item in enumerate(response.get("sub_queries", [])):
            sub_query = SubQuery(
                id=f"sq_{idx}",
                text=item["text"],
                dependencies=item.get("dependencies", []),
                tools_required=item.get("tools", []),
            )
            sub_queries.append(sub_query)
        return sub_queries

    def create_dependency_graph(self, sub_queries: List[SubQuery]) -> None:
        """Create a directed graph representing query dependencies."""
        self.dependency_graph.clear()
        
        # Add nodes for each sub-query
        for sq in sub_queries:
            self.dependency_graph.add_node(sq.id, query=sq)

        # Add edges for dependencies
        for sq in sub_queries:
            for dep in sq.dependencies:
                self.dependency_graph.add_edge(dep, sq.id)

        # Validate acyclic nature of graph
        if not nx.is_directed_acyclic_graph(self.dependency_graph):
            raise ValueError("Circular dependencies detected in sub-queries")

        self._track_step("graph_creation", {
            "nodes": len(self.dependency_graph.nodes),
            "edges": len(self.dependency_graph.edges)
        })

    def _track_step(self, action: str, details: Dict) -> None:
        """Track reasoning steps with timestamps."""
        step = ReasoningStep(
            step_id=f"step_{len(self.reasoning_steps)}",
            timestamp=datetime.now(),
            action=action,
            details=details,
            status="completed"
        )
        self.reasoning_steps.append(step)
        self.logger.info(f"Reasoning step: {action}", extra={"details": details})

    def get_execution_plan(self) -> List[List[str]]:
        """Generate execution plan based on dependency graph."""
        if not self.dependency_graph.nodes:
            return []

        # Use topological sort to get execution layers
        execution_layers = []
        remaining_nodes = set(self.dependency_graph.nodes)
        
        while remaining_nodes:
            # Find nodes with no remaining dependencies
            available_nodes = {
                node for node in remaining_nodes 
                if not any(pred in remaining_nodes 
                          for pred in self.dependency_graph.predecessors(node))
            }
            
            if not available_nodes:
                raise ValueError("Circular dependency detected in execution plan")
                
            execution_layers.append(list(available_nodes))
            remaining_nodes -= available_nodes

        return execution_layers

    def validate_query(self, query: str) -> bool:
        """Validate query structure and content."""
        # Implement validation logic
        if not query or len(query.strip()) == 0:
            return False
        
        # Add more validation rules as needed
        return True

    def optimize_execution_plan(self, execution_layers: List[List[str]]) -> List[List[str]]:
        """Optimize the execution plan for parallel processing."""
        optimized_layers = []
        for layer in execution_layers:
            # Group queries by tool requirements for parallel execution
            tool_groups = {}
            for query_id in layer:
                query = self.dependency_graph.nodes[query_id]['query']
                tool_key = tuple(sorted(query.tools_required))
                tool_groups.setdefault(tool_key, []).append(query_id)
            
            optimized_layers.extend([group for group in tool_groups.values()])
        
        return optimized_layers

    def export_reasoning_trace(self) -> Dict:
        """Export the reasoning process trace."""
        return {
            "steps": [
                {
                    "step_id": step.step_id,
                    "timestamp": step.timestamp.isoformat(),
                    "action": step.action,
                    "details": step.details,
                    "status": step.status
                }
                for step in self.reasoning_steps
            ],
            "execution_plan": self.get_execution_plan(),
            "graph_structure": {
                "nodes": list(self.dependency_graph.nodes),
                "edges": list(self.dependency_graph.edges)
            }
        }
