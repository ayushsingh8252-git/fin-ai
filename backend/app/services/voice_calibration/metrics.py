"""Biometric Verification and Identification Metrics (FAR, FRR, EER, ROC-AUC, Top-1/5)."""
from __future__ import annotations

import math
from typing import List, Dict, Tuple, Optional, Any
import numpy as np

from .scoring import cosine_similarity


class VerificationMetrics:
    """Calculates 1:1 biometric evaluation metrics: FAR, FRR, EER, ROC-AUC, TAR@FAR."""

    @staticmethod
    def calculate_far_frr_curve(
        genuine_scores: List[float],
        impostor_scores: List[float],
        num_thresholds: int = 1000,
    ) -> Dict[str, Any]:
        """Evaluates False Acceptance Rate (FAR) and False Rejection Rate (FRR) across threshold range."""
        if not genuine_scores or not impostor_scores:
            return {"thresholds": [], "far": [], "frr": []}

        gen = np.sort(np.asarray(genuine_scores, dtype=np.float64))
        imp = np.sort(np.asarray(impostor_scores, dtype=np.float64))

        min_score = min(float(gen[0]), float(imp[0]))
        max_score = max(float(gen[-1]), float(imp[-1]))
        thresholds = np.linspace(min_score - 1e-4, max_score + 1e-4, num_thresholds)

        # FAR = impostors >= threshold / total impostors
        # Using searchsorted for speed
        imp_idx = np.searchsorted(imp, thresholds, side="left")
        far = (len(imp) - imp_idx) / len(imp)

        # FRR = genuine < threshold / total genuine
        gen_idx = np.searchsorted(gen, thresholds, side="left")
        frr = gen_idx / len(gen)

        return {
            "thresholds": thresholds.tolist(),
            "far": far.tolist(),
            "frr": frr.tolist(),
        }

    @classmethod
    def calculate_eer(
        cls,
        genuine_scores: List[float],
        impostor_scores: List[float],
    ) -> Tuple[float, float]:
        """Calculates Equal Error Rate (EER) and the corresponding EER threshold."""
        curve = cls.calculate_far_frr_curve(genuine_scores, impostor_scores, num_thresholds=2000)
        far = np.array(curve["far"])
        frr = np.array(curve["frr"])
        thresholds = np.array(curve["thresholds"])

        if len(far) == 0:
            return 0.0, 0.70

        # Find intersection where |FAR - FRR| is minimal
        diff = np.abs(far - frr)
        best_idx = np.argmin(diff)

        # Linear interpolation around the best index if possible
        if 0 < best_idx < len(thresholds) - 1:
            idx0, idx1 = best_idx - 1, best_idx + 1
            eer_val = float((far[best_idx] + frr[best_idx]) / 2.0)
            eer_thresh = float(thresholds[best_idx])
        else:
            eer_val = float(far[best_idx])
            eer_thresh = float(thresholds[best_idx])

        return round(eer_val * 100.0, 3), round(eer_thresh, 4)

    @classmethod
    def calculate_tar_at_far(
        cls,
        genuine_scores: List[float],
        impostor_scores: List[float],
        target_far_percent: float = 0.1,  # 0.1% = 0.001
    ) -> Tuple[float, float]:
        """Calculates True Acceptance Rate (TAR = 1 - FRR) at a target FAR percentage."""
        curve = cls.calculate_far_frr_curve(genuine_scores, impostor_scores, num_thresholds=5000)
        target_far = target_far_percent / 100.0

        far = np.array(curve["far"])
        frr = np.array(curve["frr"])
        thresholds = np.array(curve["thresholds"])

        # Find threshold where FAR <= target_far
        valid_indices = np.where(far <= target_far)[0]
        if len(valid_indices) == 0:
            # Strictest threshold available
            chosen_idx = -1
        else:
            chosen_idx = valid_indices[0]

        operating_threshold = float(thresholds[chosen_idx])
        operating_frr = float(frr[chosen_idx])
        tar = float(max(0.0, (1.0 - operating_frr) * 100.0))

        return round(tar, 2), round(operating_threshold, 4)

    @staticmethod
    def calculate_roc_auc(genuine_scores: List[float], impostor_scores: List[float]) -> float:
        """Calculates Area Under the ROC Curve (Mann-Whitney U statistic)."""
        if not genuine_scores or not impostor_scores:
            return 0.5
        gen = np.asarray(genuine_scores)
        imp = np.asarray(impostor_scores)
        # Fraction of genuine scores higher than impostor scores
        # Vectorized comparison if sizes allow
        if len(gen) * len(imp) <= 500_000:
            gt = (gen[:, None] > imp[None, :]).astype(float)
            eq = (gen[:, None] == imp[None, :]).astype(float) * 0.5
            auc = float(np.mean(gt + eq))
        else:
            # Fallback to sorting ranks
            all_scores = np.concatenate([gen, imp])
            labels = np.concatenate([np.ones_like(gen), np.zeros_like(imp)])
            order = np.argsort(all_scores)
            ranks = np.empty_like(order)
            ranks[order] = np.arange(len(all_scores)) + 1
            sum_ranks_gen = np.sum(ranks[labels == 1])
            n_gen, n_imp = len(gen), len(imp)
            u_stat = sum_ranks_gen - (n_gen * (n_gen + 1)) / 2.0
            auc = float(u_stat / (n_gen * n_imp))

        return round(auc, 4)


class IdentificationMetrics:
    """Calculates 1:N biometric identification evaluation metrics."""

    @staticmethod
    def evaluate_1_to_n(
        gallery_speaker_ids: List[str],
        gallery_centroids: List[List[float]],
        probe_speaker_ids: List[str],
        probe_embeddings: List[List[float]],
        threshold: float = 0.70,
        margin_threshold: float = 0.10,
    ) -> Dict[str, Any]:
        """Evaluates Top-1, Top-5 accuracy, unknown rejection rate, and score margins.
        
        probe_speaker_ids may contain 'unknown_*' IDs that are not present in gallery.
        """
        if not gallery_speaker_ids or not probe_speaker_ids:
            return {
                "top1_accuracy": 0.0,
                "top5_accuracy": 0.0,
                "unknown_rejection_rate": 0.0,
                "false_identification_rate": 0.0,
                "avg_margin": 0.0,
            }

        gallery_matrix = np.array(gallery_centroids, dtype=np.float32)
        gallery_norms = np.linalg.norm(gallery_matrix, axis=1, keepdims=True)
        gallery_matrix = gallery_matrix / np.maximum(gallery_norms, 1e-10)

        known_probes = 0
        top1_correct = 0
        top5_correct = 0
        unknown_probes = 0
        unknown_rejected = 0
        false_identified = 0
        margins = []

        gallery_set = set(gallery_speaker_ids)

        for true_id, probe_emb in zip(probe_speaker_ids, probe_embeddings):
            emb = np.array(probe_emb, dtype=np.float32)
            emb = emb / max(np.linalg.norm(emb), 1e-10)
            scores = np.dot(gallery_matrix, emb)

            sorted_indices = np.argsort(scores)[::-1]
            top_score = float(scores[sorted_indices[0]])
            runner_up = float(scores[sorted_indices[1]]) if len(sorted_indices) > 1 else 0.0
            margin = top_score - runner_up
            margins.append(margin)

            top1_id = gallery_speaker_ids[sorted_indices[0]]
            top5_ids = [gallery_speaker_ids[idx] for idx in sorted_indices[:min(5, len(sorted_indices))]]

            is_known = true_id in gallery_set

            if is_known:
                known_probes += 1
                # Accepted if top_score >= threshold and margin >= margin_threshold
                if top1_id == true_id and top_score >= threshold and margin >= margin_threshold:
                    top1_correct += 1
                if true_id in top5_ids and top_score >= threshold:
                    top5_correct += 1
            else:
                unknown_probes += 1
                if top_score < threshold or margin < margin_threshold:
                    unknown_rejected += 1
                else:
                    false_identified += 1

        top1_acc = (top1_correct / known_probes * 100.0) if known_probes > 0 else 0.0
        top5_acc = (top5_correct / known_probes * 100.0) if known_probes > 0 else 0.0
        unknown_rej = (unknown_rejected / unknown_probes * 100.0) if unknown_probes > 0 else 100.0
        false_id_rate = (false_identified / unknown_probes * 100.0) if unknown_probes > 0 else 0.0
        avg_margin = float(np.mean(margins)) if margins else 0.0

        return {
            "known_probes_count": known_probes,
            "unknown_probes_count": unknown_probes,
            "top1_accuracy": round(top1_acc, 2),
            "top5_accuracy": round(top5_acc, 2),
            "unknown_rejection_rate": round(unknown_rej, 2),
            "false_identification_rate": round(false_id_rate, 2),
            "avg_margin": round(avg_margin, 4),
            "margin_p10": round(float(np.percentile(margins, 10)), 4) if margins else 0.0,
            "margin_p50": round(float(np.percentile(margins, 50)), 4) if margins else 0.0,
        }
