// ============================================================
// STATE
// ============================================================
let state = {
  orgName: '',
  meetingDate: '',
  meetingType: 'Regular Board Meeting',
  meetingLocation: '',
  meetingAddress: '',
  timeCalled: '',
  timeAdjourned: '',
  additionalAttendees: '',
  roster: [],
  attendance: {}, // memberId -> { status, timeArrived, timeDeparted }
  agenda: [],
  discussion: [],
  actionItems: []
};

const RECURRING_AGENDA = [
  { title: 'Call to Order', type: 'Procedural', notes: '', recurring: true },
  { title: 'Approval of Prior Meeting Minutes', type: 'Action', notes: '', recurring: true },
  { title: "Treasurer's Report", type: 'Report', notes: '', recurring: true },
  { title: 'Open Forum / Public Comment', type: 'Discussion', notes: '', recurring: true },
  { title: 'Adjournment', type: 'Procedural', notes: '', recurring: true }
];

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  renderAll();
  startClock();
  // default date to today
  if (!state.meetingDate) {
    state.meetingDate = new Date().toISOString().split('T')[0];
    renderMeetingDetails();
  }
});

// ...existing code...
