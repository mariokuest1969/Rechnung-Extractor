import { Router, type IRouter } from "express";
import healthRouter from "./health";
import invoicesRouter from "./invoices";
import settingsRouter from "./settings";
import lieferantenRouter from "./lieferanten";
import buchungskontenRouter from "./buchungskonten";

const router: IRouter = Router();

router.use(healthRouter);
router.use(invoicesRouter);
router.use(settingsRouter);
router.use(lieferantenRouter);
router.use(buchungskontenRouter);

export default router;
