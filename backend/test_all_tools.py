"""
Comprehensive End-to-End Tool Tester
Tests every registered connector and tool via registry.call_tool
"""
import json
import sys
from app.agent_tools import registry

def run_tests():
    print("==================================================")
    print("TESTING ALL AGENT TOOLS IN UNIFIED CATALOG")
    print("==================================================")
    
    catalog = registry.unified_catalog()
    print(f"Total tools in catalog: {len(catalog)}")
    
    results = []
    
    # Test cases for each known connector and tool
    test_cases = {
        ("hiring", "get_candidate_profile"): {
            "filename": "ayush-singh-resume.pdf",
            "file_path": "uploads/hiring/ayush_singh_resume.pdf"
        },
        ("hiring", "match_candidate_requirement"): {
            "candidate": {
                "name": "Ayush Singh",
                "skills": ["Python", "FastAPI", "React", "Next.js"],
                "experience": "5+ years",
                "summary": "Senior AI Systems Engineer"
            },
            "requirement": "Senior AI Engineer with Python and FastAPI",
            "role_title": "Senior AI Engineer"
        },
        ("hiring", "generate_candidate_assignment"): {
            "requirement": "Senior AI Engineer with Python and FastAPI",
            "role_title": "Senior AI Engineer"
        },
        ("hiring", "calculate_candidate_score"): {
            "candidate": {
                "name": "Ayush Singh",
                "skills": ["Python", "FastAPI", "React"],
                "experience": "5 years"
            },
            "requirement": "Python and FastAPI developer",
            "role_title": "Backend Developer"
        },
        ("hiring", "generate_candidate_scorecard"): {
            "candidate_name": "Ayush Singh",
            "candidate_email": "ayush@example.com",
            "role_title": "Senior AI Systems Engineer"
        },
        ("fraud", "run_fraud_check"): {
            "scan_id": "test_scan_001"
        },
        ("rag", "query_documents"): {
            "query": "What is the policy for candidate screening?",
            "top_k": 3
        },
        ("google_workspace_status", "get_google_integration_status"): {},
        ("background_verification", "verify_company_background"): {
            "company_name": "AgenticFlow AI",
            "location": "India"
        },
        ("whatsapp", "send_whatsapp_message"): {
            "recipient": "+919876543210",
            "message": "Hello from automated tool test"
        },
        ("whatsapp", "get_whatsapp_message_status"): {
            "message_id": "wamid.test001"
        },
        ("telephonic", "get_call_status"): {
            "call_id": "test_call_001"
        },
        ("voice_id", "identify_voice_speaker"): {
            "audio_base64": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
        },
    }
    
    for tool_info in catalog:
        c_name = tool_info["connector"]
        t_name = tool_info["tool"]
        
        sample_params = test_cases.get((c_name, t_name), {})
        
        try:
            res = registry.call_tool(c_name, t_name, sample_params)
            print(f"[PASS] {c_name}::{t_name} -> OK (type: {type(res).__name__})")
            results.append({"connector": c_name, "tool": t_name, "status": "PASS", "result_snippet": str(res)[:100]})
        except Exception as e:
            print(f"[FAIL] {c_name}::{t_name} -> ERROR: {e}")
            results.append({"connector": c_name, "tool": t_name, "status": "FAIL", "error": str(e)})

    print("==================================================")
    print(f"Summary: {sum(1 for r in results if r['status'] == 'PASS')}/{len(results)} passed")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
