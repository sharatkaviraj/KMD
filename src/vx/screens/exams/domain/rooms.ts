/*
 * Seating and invigilation, worked out rather than typed in.
 *
 * Seating puts two classes in a room and alternates them seat by seat, so the
 * child beside you is from another class and is sitting another paper.
 * Duties go to whoever has had the fewest so far, never twice in a day.
 */

export type Room = { id: string; name: string; seats: number; cols: number };
export type SeatClass = { classId: string; label: string; students: { studentId: string; roll: string | null }[] };
export type Seat = { roomId: string; seatNo: number; classId: string; studentId: string };

function byRoll(a: { roll: string | null; studentId: string }, b: { roll: string | null; studentId: string }): number {
  const ra = Number(a.roll ?? NaN);
  const rb = Number(b.roll ?? NaN);
  if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) return ra - rb;
  return (a.roll ?? "").localeCompare(b.roll ?? "") || a.studentId.localeCompare(b.studentId);
}

export function seatPlan(rooms: Room[], classes: SeatClass[]): { seats: Seat[]; unseated: number } {
  // Biggest classes first, each in roll order.
  const queue = classes
    .filter((c) => c.students.length > 0)
    .map((c) => ({ classId: c.classId, left: [...c.students].sort(byRoll) }))
    .sort((a, b) => b.left.length - a.left.length || a.classId.localeCompare(b.classId));

  const seats: Seat[] = [];
  let pair: (typeof queue)[number][] = [];
  const refill = () => {
    pair = pair.filter((c) => c.left.length > 0);
    while (pair.length < 2 && queue.length > 0) {
      const next = queue.shift()!;
      if (next.left.length > 0) pair.push(next);
    }
  };

  for (const room of rooms) {
    refill();
    if (pair.length === 0) break;
    let turn = 0;
    for (let seatNo = 1; seatNo <= room.seats; seatNo += 1) {
      refill();
      if (pair.length === 0) break;
      const from = pair[turn % pair.length];
      const student = from.left.shift()!;
      seats.push({ roomId: room.id, seatNo, classId: from.classId, studentId: student.studentId });
      turn += 1;
    }
  }
  const unseated = pair.reduce((a, c) => a + c.left.length, 0) + queue.reduce((a, c) => a + c.left.length, 0);
  return { seats, unseated };
}

/** A room's seats as rows of `cols`, for the seat chart. */
export function chartRows<T extends { seatNo: number }>(seats: T[], capacity: number, cols: number): (T | null)[][] {
  const at = new Map(seats.map((s) => [s.seatNo, s]));
  const rows: (T | null)[][] = [];
  for (let start = 1; start <= capacity; start += cols) {
    const row: (T | null)[] = [];
    for (let n = start; n < start + cols && n <= capacity; n += 1) row.push(at.get(n) ?? null);
    rows.push(row);
  }
  return rows;
}

/** How many seats in a room have a neighbour (left or right) from the same class. */
export function sameClassNeighbours(seats: Seat[], cols: number): number {
  const at = new Map(seats.map((s) => [`${s.roomId}|${s.seatNo}`, s]));
  let n = 0;
  for (const seat of seats) {
    if ((seat.seatNo - 1) % cols === cols - 1) continue;
    const right = at.get(`${seat.roomId}|${seat.seatNo + 1}`);
    if (right && right.classId === seat.classId) n += 1;
  }
  return n;
}

export type Duty = { day: string; roomId: string; staffId: string };
export type Invigilator = { id: string; name: string };

/** How many invigilators a room needs: one per 40 seats used, at least one. */
export function invigilatorsFor(seatsUsed: number): number {
  return Math.max(1, Math.ceil(seatsUsed / 40));
}

/**
 * Fill every room on every exam day with the people who have had the fewest
 * duties, nobody twice on one day. `fixed` duties stay where they are and
 * count towards fairness. Ties go by name, so the same inputs give the same
 * roster every time.
 */
export function assignDuties(input: {
  days: string[];
  rooms: { id: string; need: number }[];
  staff: Invigilator[];
  fixed?: Duty[];
}): Duty[] {
  const count = new Map(input.staff.map((s) => [s.id, 0]));
  const fixed = input.fixed ?? [];
  for (const d of fixed) count.set(d.staffId, (count.get(d.staffId) ?? 0) + 1);
  const out: Duty[] = [...fixed];
  const names = new Map(input.staff.map((s) => [s.id, s.name]));

  for (const day of input.days) {
    const busy = new Set(out.filter((d) => d.day === day).map((d) => d.staffId));
    for (const room of input.rooms) {
      const have = out.filter((d) => d.day === day && d.roomId === room.id).length;
      for (let k = have; k < room.need; k += 1) {
        const pick = input.staff
          .filter((s) => !busy.has(s.id))
          .sort((a, b) => (count.get(a.id) ?? 0) - (count.get(b.id) ?? 0) || (names.get(a.id) ?? "").localeCompare(names.get(b.id) ?? "") || a.id.localeCompare(b.id))[0];
        if (!pick) break;
        out.push({ day, roomId: room.id, staffId: pick.id });
        busy.add(pick.id);
        count.set(pick.id, (count.get(pick.id) ?? 0) + 1);
      }
    }
  }
  return out;
}

/** Fewest and most duties anyone has: fair when the two differ by at most one. */
export function dutySpread(duties: Duty[], staff: Invigilator[]): { min: number; max: number; fair: boolean } {
  const count = new Map(staff.map((s) => [s.id, 0]));
  for (const d of duties) count.set(d.staffId, (count.get(d.staffId) ?? 0) + 1);
  const values = [...count.values()];
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  return { min, max, fair: max - min <= 1 };
}
