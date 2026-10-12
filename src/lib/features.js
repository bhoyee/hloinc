'use strict';

/**
 * Parts of the system that follow what the public website offers. When HLO's
 * website design changes what visitors can send, switch the matching portal
 * features here (nothing is deleted, so they can come back).
 */
module.exports = {
  // Website "Request an appointment" form: hidden in HLO's design (version 20, October 2026).
  // Off: no Requests tab or "to confirm" counters, no appointment-request alerts or
  // "waiting too long" checks, and appointments are booked by staff only.
  appointmentRequests: false,
};
