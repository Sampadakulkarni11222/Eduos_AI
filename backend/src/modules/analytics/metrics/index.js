/**
 * Registration point for the metric catalogue. Each import registers its
 * metrics with catalogue.registerMetric() as a side effect.
 *
 * A module that adds metrics (labs, fleet, PTM, clubs, sustainability, bills)
 * adds ONE line here pointing at its own metrics file, e.g.
 *   import '../../labs/labs.metrics.js';
 */
import './admissions.js';
import './academics.js';
import './finance.js';
import './procurement.js';
import './operations.js';
import '../../clubs/clubs.metrics.js';
import '../../sustainability/sustainability.metrics.js';
