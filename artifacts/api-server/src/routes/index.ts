import { Router, type IRouter } from "express";
import healthRouter from "./health";
import invoicesRouter from "./invoices";

const router: IRouter = Router();

router.use(healthRouter);
router.use(invoicesRouter);

export default router;
