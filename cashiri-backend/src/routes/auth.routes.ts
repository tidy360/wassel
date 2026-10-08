import { Router } from "express";
import { forgotPassword, login, me, resetPassword, updateMe } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, updateMe);

export default router;
