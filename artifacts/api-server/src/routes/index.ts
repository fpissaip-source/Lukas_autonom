import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lukasRouter from "./lukas";
import higgsfieldRouter from "./higgsfield";
import anthropicRouter from "./anthropic";
import tradesRouter from "./trades";
import publicRouter from "./public";
import attachmentsRouter from "./attachments";
import whatsappRouter from "./whatsapp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(lukasRouter);
router.use(higgsfieldRouter);
router.use(anthropicRouter);
router.use(tradesRouter);
router.use(publicRouter);
router.use(attachmentsRouter);
router.use(whatsappRouter);

export default router;
