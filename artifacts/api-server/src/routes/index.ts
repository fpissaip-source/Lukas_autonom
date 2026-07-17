import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lukasRouter from "./lukas";
import higgsfieldRouter from "./higgsfield";
import anthropicRouter from "./anthropic";
import tradesRouter from "./trades";
import publicRouter from "./public";

const router: IRouter = Router();

router.use(healthRouter);
router.use(lukasRouter);
router.use(higgsfieldRouter);
router.use(anthropicRouter);
router.use(tradesRouter);
router.use(publicRouter);

export default router;
