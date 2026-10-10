from app.db.repositories import RecommendationRepository

class RecommendationTools:
    def read_recommendations(self, args):
        repo = RecommendationRepository(self.session)
        rows = repo.list_all() if args.rec_key is None else [repo.get(args.rec_key)]
        if args.rec_key is not None and rows[0] is None:
            return {"error": "Unknown criterion key. Omit rec_key to read the full table."}
        return {"recommendations": [{"key": r.rec_key, "title": r.title, "tensorflow_js": r.tfjs_verdict,
            "gemini_nano": r.gemini_verdict, "comment": r.comment} for r in rows if r is not None]}
