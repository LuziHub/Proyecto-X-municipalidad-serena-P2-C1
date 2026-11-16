'use strict';

const express = require('express');
const router = express.Router();

router.use(require('./auth'));
router.use(require('./matriz'));   // antes de crud: /tubo/tablero no debe leerse como /tubo/:id
router.use(require('./crud'));

module.exports = router;
