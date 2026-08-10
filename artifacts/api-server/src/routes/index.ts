import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lukasRouter from "./lukas";
import higgsfieldRouter from "./higgsfield";
import anthropicRouter from "./anthropic";
import tradesRouter from "./trades";
import publicRouter from "./public";
import attachmentsRouter from "./attachments";
import whatsappRouter from "./whatsapp";
import approvalsRouter from "./approvals";
import proposalsRouter from "./proposals";

const router: IRouter = Router();

router.use(healthRouter);
router.use(lukasRouter);
router.use(higgsfieldRouter);
router.use(anthropicRouter);
router.use(tradesRouter);
router.use(publicRouter);
router.use(attachmentsRouter);
router.use(whatsappRouter);
router.use(approvalsRouter);
router.use(proposalsRouter);

export default router;
