import uuid
from datetime import datetime, timezone
from app.database import SessionLocal
from app.models import Candidate, Application, Role, FraudScan, Offer, WhatsAppMessage
from app.services import recruitment_service as rs

def seed_indian_candidates():
    db = SessionLocal()
    print("Beginning Indian demo data update...")

    # 1. Update Candidate 1dec9564 (app 433bec8c) to Priya Sharma
    cand_elena = db.query(Candidate).filter(Candidate.id == '1dec9564-4da1-4890-9f67-5ac5b4da8ddc').first()
    if cand_elena:
        cand_elena.name = 'Priya Sharma'
        cand_elena.email = 'priya.sharma@example.com'
        cand_elena.email_key = rs.normalize_email('priya.sharma@example.com')
        cand_elena.phone = '+91 98450 12894'
        cand_elena.location = 'Bengaluru, KA (Hybrid)'
        cand_elena.current_role = 'Senior AI Platform Engineer at Swiggy Labs'
        cand_elena.experience_years = 5.5
        cand_elena.skills = ['Python', 'FastAPI', 'Vector Databases', 'Redis', 'Celery', 'Docker', 'PyTorch']
        cand_elena.resume_filename = 'priya_sharma_cv.pdf'
        cand_elena.resume_text = 'Priya Sharma - Senior AI Platform Engineer with 5.5 years in distributed ML inference, FastAPI microservices, and vector search systems at Swiggy Labs.'
        
        app = db.query(Application).filter(Application.id == '433bec8c-e0b9-472b-9b03-c68ab0214b5e').first()
        if app:
            app.matched_skills = ['Python', 'FastAPI', 'Vector Databases', 'Redis', 'Celery', 'PyTorch']
            app.missing_skills = []
            app.match_score = 93
            app.ats_score = 90
            app.recommendation = 'Strong Match'
            app.ai_summary = 'Priya Sharma demonstrates exceptional alignment for Lead AI Systems Engineer. 5.5 years at Swiggy Labs building high-throughput vector retrieval pipelines with FastAPI and PyTorch.'

        offer = db.query(Offer).filter(Offer.application_id == '433bec8c-e0b9-472b-9b03-c68ab0214b5e').first()
        if offer:
            offer.notes = 'Compensation: Base INR 42,00,000 + 0.35% ESOPs. Annual Learning Stipend INR 1,50,000, Premium Health Insurance.'

        # Sample WhatsApp message for Priya
        wa_exists = db.query(WhatsAppMessage).filter(WhatsAppMessage.to_number == '+91 98450 12894').first()
        if not wa_exists:
            db.add(WhatsAppMessage(
                id=str(uuid.uuid4()),
                direction='outbound',
                to_number='+91 98450 12894',
                from_number='Talent Partner',
                message_type='text',
                body='Hi Priya! Congratulations on reaching the formal offer stage for Lead AI / ML Systems Engineer. We have prepared your compensation package.',
                status='delivered',
                created_at=datetime.now(timezone.utc)
            ))
        print("Updated Candidate 433bec8c to Priya Sharma (Bengaluru, KA)")

    # 2. Add More Indian Demo Candidates for Job 4b433e2b-dcb2-4641-8c6c-863dee481b4d
    job = db.query(Role).filter(Role.id == '4b433e2b-dcb2-4641-8c6c-863dee481b4d').first()
    if job:
        indian_candidates = [
            {
                'name': 'Aarav Patel',
                'email': 'aarav.patel@example.com',
                'phone': '+91 98201 34567',
                'location': 'Mumbai, MH (Remote/Hybrid)',
                'current_role': 'Staff ML Engineer at Razorpay',
                'experience_years': 6.0,
                'skills': ['Python', 'PyTorch', 'FastAPI', 'Vector Databases', 'LangChain', 'Kubernetes'],
                'match_score': 95,
                'ats_score': 93,
                'stage': 'SHORTLISTED',
                'rec': 'Strong Match',
                'summary': 'Ex-IIT Bombay. 6 years leading fraud AI models and real-time streaming ML pipelines at Razorpay.',
            },
            {
                'name': 'Ananya Iyer',
                'email': 'ananya.iyer@example.com',
                'phone': '+91 99400 87654',
                'location': 'Bengaluru, KA',
                'current_role': 'Senior Backend & Search Architect at Flipkart',
                'experience_years': 4.5,
                'skills': ['Python', 'FastAPI', 'Redis', 'Vector Databases', 'ElasticSearch'],
                'match_score': 89,
                'ats_score': 87,
                'stage': 'INTERVIEW',
                'rec': 'Strong Match',
                'summary': 'Core search ranking engineer at Flipkart. Deep familiarity with high-concurrency search and vector retrieval.',
            },
            {
                'name': 'Rohan Verma',
                'email': 'rohan.verma@example.com',
                'phone': '+91 97110 56789',
                'location': 'Gurugram, HR',
                'current_role': 'AI Research Engineer at Zomato AI',
                'experience_years': 3.5,
                'skills': ['Python', 'PyTorch', 'FastAPI', 'HuggingFace', 'Docker'],
                'match_score': 82,
                'ats_score': 84,
                'stage': 'SCREENING',
                'rec': 'Good Match',
                'summary': 'Strong practical background fine-tuning multimodal models for food recommendation at Zomato.',
            },
            {
                'name': 'Vikram Malhotra',
                'email': 'vikram.malhotra@example.com',
                'phone': '+91 99887 65432',
                'location': 'Hyderabad, TS',
                'current_role': 'AI Infrastructure Engineer at Microsoft IDC',
                'experience_years': 5.0,
                'skills': ['Python', 'FastAPI', 'Vector Databases', 'PyTorch', 'Azure AI'],
                'match_score': 91,
                'ats_score': 89,
                'stage': 'SELECTED',
                'rec': 'Strong Match',
                'summary': '5 years optimizing large language model latency on cloud infrastructure at Microsoft Hyderabad.',
            },
            {
                'name': 'Sneha Kulkarni',
                'email': 'sneha.kulkarni@example.com',
                'phone': '+91 98810 23456',
                'location': 'Pune, MH',
                'current_role': 'Data & ML Systems Engineer at Persistent',
                'experience_years': 2.5,
                'skills': ['Python', 'FastAPI', 'Docker', 'PostgreSQL'],
                'match_score': 68,
                'ats_score': 72,
                'stage': 'APPLIED',
                'rec': 'Review Required',
                'summary': 'Promising engineer with solid backend foundations; lacks production vector database experience.',
            },
        ]

        for cdata in indian_candidates:
            cand = db.query(Candidate).filter(Candidate.email == cdata['email']).first()
            if not cand:
                safe_name = cdata['name'].lower().replace(' ', '_')
                cand = Candidate(
                    id=str(uuid.uuid4()),
                    name=cdata['name'],
                    email=cdata['email'],
                    email_key=rs.normalize_email(cdata['email']),
                    phone=cdata['phone'],
                    location=cdata['location'],
                    current_role=cdata['current_role'],
                    experience_years=cdata['experience_years'],
                    skills=cdata['skills'],
                    resume_filename=f"{safe_name}_cv.pdf",
                    resume_text=f"{cdata['name']} - {cdata['current_role']}. Skills: {', '.join(cdata['skills'])}. Experience: {cdata['experience_years']} years.",
                    source="demo_seed",
                    created_at=datetime.now(timezone.utc)
                )
                db.add(cand)
                db.flush()

                scan = FraudScan(
                    id=str(uuid.uuid4()),
                    filename=cand.resume_filename,
                    file_path='/app/uploads/demo.pdf',
                    content_type='pdf',
                    status='complete',
                    result={
                        'risk_level': 'low',
                        'overall_score': 10,
                        'recommendation': 'Document Verified Clean',
                        'findings': []
                    },
                    created_at=datetime.now(timezone.utc)
                )
                db.add(scan)
                db.flush()

                app = Application(
                    id=str(uuid.uuid4()),
                    candidate_id=cand.id,
                    job_id=job.id,
                    stage=cdata['stage'],
                    match_score=cdata['match_score'],
                    ats_score=cdata['ats_score'],
                    matched_skills=[s for s in cdata['skills'] if s in job.must_have_skills or s in (job.preferred_skills or [])],
                    missing_skills=[s for s in job.must_have_skills if s not in cdata['skills']],
                    recommendation=cdata['rec'],
                    ai_summary=cdata['summary'],
                    analysis_status='completed',
                    score_provenance={
                        'ats_score': {'status': 'computed', 'source': 'deterministic'},
                        'match_score': {'status': 'computed', 'source': 'llm'},
                    },
                    fraud_scan_id=scan.id,
                    created_at=datetime.now(timezone.utc)
                )
                db.add(app)
                print(f"Created {cdata['name']} in stage {cdata['stage']} (App ID: {app.id})")

    db.commit()
    print("Finished seeding Indian demo candidates successfully!")
    db.close()

if __name__ == '__main__':
    seed_indian_candidates()
