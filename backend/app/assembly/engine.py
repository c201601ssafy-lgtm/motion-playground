"""조립 규칙 엔진 (D-006, D-013).

조립 판정의 유일한 권한. LLM이나 프론트엔드는 판정하지 않는다.
"""

import math
from collections import deque

from app.assembly.schemas import (
    AssemblyResult,
    AssemblySnapshot,
    AssemblyState,
    AttemptRequest,
    ErrorType,
    GearState,
    MechanismState,
)
from app.core.model_schema import MechanismModel, Slot, Vec3

ORIENTATION_TOLERANCE_DEG = 15.0


def _angle_between(a: Vec3, b: Vec3) -> float:
    na, nb = math.hypot(*a), math.hypot(*b)
    if na == 0 or nb == 0:
        return 180.0
    cos = sum(x * y for x, y in zip(a, b, strict=True)) / (na * nb)
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def _yaw_error(current: float, expected: float, symmetry: float) -> float:
    d = (current - expected) % symmetry
    return min(d, symmetry - d)


class AssemblyEngine:
    def __init__(self, model: MechanismModel, state: AssemblyState | None = None) -> None:
        self.model = model
        self.state = state or AssemblyState()

    # ---------- 조회 ----------

    def is_placed(self, part_id: str) -> bool:
        return part_id in self.state.placed.values()

    def _step_complete(self, step: int) -> bool:
        st = next((s for s in self.model.steps if s.step == step), None)
        return st is not None and all(sid in self.state.placed for sid in st.slots)

    def completed_steps(self) -> list[int]:
        return [st.step for st in self.model.steps if self._step_complete(st.step)]

    def current_step(self) -> int | None:
        return next(
            (
                st.step
                for st in sorted(self.model.steps, key=lambda s: s.step)
                if not self._step_complete(st.step)
            ),
            None,
        )

    def snapshot(self) -> AssemblySnapshot:
        return AssemblySnapshot(
            placed=dict(self.state.placed),
            completed_steps=self.completed_steps(),
            current_step=self.current_step(),
            parts_placed=len(self.state.placed),
            parts_total=len(self.model.parts),
            is_complete=len(self.state.placed) == len(self.model.slots),
            last_error=self.state.last_error,
        )

    # ---------- 판정 ----------

    def _pick_slot(self, req: AttemptRequest) -> tuple[Slot, float] | None:
        """정답 슬롯이 반경 안이면 그 슬롯, 아니면 반경 안의 가장 가까운 슬롯 (D-013)."""
        in_range = [
            (s, d)
            for s in self.model.slots
            if (d := math.dist(req.position, s.position)) <= s.snap_radius
        ]
        if not in_range:
            return None
        own = next(((s, d) for s, d in in_range if s.accepts_part_id == req.part_id), None)
        return own or min(in_range, key=lambda sd: sd[1])

    def attempt(self, req: AttemptRequest) -> AssemblyResult:
        result = self._judge(req)
        if result.is_valid:
            self.state.last_error = None
        elif result.error_type is not ErrorType.TOO_FAR:
            self.state.last_error = result
        return result

    def _judge(self, req: AttemptRequest) -> AssemblyResult:
        pid = req.part_id
        part = self.model.part(pid)
        if part is None:
            return self._fail(pid, ErrorType.UNKNOWN_PART, f"알 수 없는 부품 '{pid}'입니다.")
        if self.is_placed(pid):
            return self._fail(
                pid, ErrorType.ALREADY_PLACED, f"{part.name}은(는) 이미 조립됐습니다."
            )

        picked = self._pick_slot(req)
        if picked is None:
            nearest = min(math.dist(req.position, s.position) for s in self.model.slots)
            return self._fail(
                pid, ErrorType.TOO_FAR, "근처에 결합 지점이 없습니다.", distance=round(nearest, 4)
            )
        slot, dist = picked
        base = {"target_slot": slot.slot_id, "distance": round(dist, 4)}

        if slot.accepts_part_id != pid:
            if slot.slot_id in self.state.placed:
                occupant = self.model.part(self.state.placed[slot.slot_id])
                return self._fail(
                    pid,
                    ErrorType.SLOT_OCCUPIED,
                    f"그 자리에는 이미 {occupant.name if occupant else '다른 부품'}이(가) 있습니다.",
                    **base,
                )
            expected = self.model.part(slot.accepts_part_id)
            return self._fail(
                pid,
                ErrorType.WRONG_SLOT,
                f"{part.name}의 자리가 아닙니다. 이 자리는 "
                f"{expected.name if expected else slot.accepts_part_id}의 자리입니다.",
                **base,
            )

        if slot.parent_part_id and not self.is_placed(slot.parent_part_id):
            parent = self.model.part(slot.parent_part_id)
            return self._fail(
                pid,
                ErrorType.MISSING_PARENT,
                f"먼저 {parent.name if parent else slot.parent_part_id}을(를) 조립해야 합니다.",
                missing_part_ids=[slot.parent_part_id],
                **base,
            )

        step = self.model.step_of_slot(slot.slot_id)
        if step is not None:
            missing_steps = [r for r in step.requires_steps if not self._step_complete(r)]
            if missing_steps:
                missing = [
                    self.model.slot(sid).accepts_part_id  # type: ignore[union-attr]
                    for st in self.model.steps
                    if st.step in missing_steps
                    for sid in st.slots
                    if sid not in self.state.placed
                ]
                return self._fail(
                    pid,
                    ErrorType.WRONG_ORDER,
                    f"아직 {', '.join(map(str, missing_steps))}단계가 끝나지 않았습니다.",
                    missing_part_ids=missing,
                    **base,
                )

        axis_angle = _angle_between(req.axis, slot.axis)
        if axis_angle > ORIENTATION_TOLERANCE_DEG:
            return self._fail(
                pid,
                ErrorType.WRONG_ORIENTATION,
                f"{part.name}이(가) {axis_angle:.0f}° 기울어져 있습니다. 축 방향을 맞추세요.",
                axis_angle_deg=round(axis_angle, 2),
                **base,
            )
        if slot.orientation_rule == "axis_and_yaw":
            yaw_err = _yaw_error(req.yaw_deg, slot.yaw_deg, slot.yaw_symmetry_deg)
            if yaw_err > ORIENTATION_TOLERANCE_DEG:
                return self._fail(
                    pid,
                    ErrorType.WRONG_ORIENTATION,
                    f"{part.name}의 방향이 {yaw_err:.0f}° 틀어져 있습니다.",
                    expected_rotation=slot.yaw_deg,
                    current_rotation=req.yaw_deg,
                    axis_angle_deg=round(axis_angle, 2),
                    **base,
                )

        self.state.placed[slot.slot_id] = pid
        step_done = step.step if step and self._step_complete(step.step) else None
        complete = len(self.state.placed) == len(self.model.slots)
        msg = f"{part.name} 조립 완료."
        if complete:
            msg += " 모든 부품을 조립했습니다!"
        elif step_done:
            msg += f" {step_done}단계 완료."
        return AssemblyResult(
            is_valid=True,
            part_id=pid,
            message=msg,
            snapped_position=slot.position,
            step_completed=step_done,
            assembly_complete=complete,
            **base,
        )

    @staticmethod
    def _fail(part_id: str, error: ErrorType, message: str, **kw) -> AssemblyResult:
        return AssemblyResult(
            is_valid=False, part_id=part_id, error_type=error, message=message, **kw
        )

    # ---------- 변경 ----------

    def reset_step(self) -> list[str]:
        """현재 단계(전부 끝났으면 마지막 단계)에 놓인 부품을 제거한다."""
        step_no = self.current_step() or max(st.step for st in self.model.steps)
        step = next(st for st in self.model.steps if st.step == step_no)
        removed = [self.state.placed.pop(sid) for sid in step.slots if sid in self.state.placed]
        self.state.last_error = None
        return removed

    def assemble_all(self) -> None:
        """데모용: 모든 부품을 정답 슬롯에 배치."""
        self.state.placed = {s.slot_id: s.accepts_part_id for s in self.model.slots}
        self.state.last_error = None

    # ---------- 기구 ----------

    def mechanism_state(self, input_rpm: float = 30.0) -> MechanismState:
        """조립된 기어의 맞물림 그래프를 따라 회전 방향·속도비를 계산한다."""
        meta = self.model.meta
        reasons = [
            f"{p.name} 미조립"
            for p in self.model.parts
            if p.kind in ("shaft", "gear") and not self.is_placed(p.part_id)
        ]

        gears: list[GearState] = []
        input_part = self.model.part(meta.input_part_id)
        input_slot = self.model.slot_for_part(meta.input_part_id)
        if input_part and input_slot and self.is_placed(input_part.part_id):
            t_in = input_part.teeth or 1
            seen = {input_slot.slot_id}
            queue: deque[tuple[Slot, int]] = deque([(input_slot, 1)])
            while queue:
                slot, direction = queue.popleft()
                part = self.model.part(slot.accepts_part_id)
                assert part is not None and part.teeth is not None
                ratio = t_in / part.teeth
                gears.append(
                    GearState(
                        part_id=part.part_id,
                        teeth=part.teeth,
                        direction=direction,
                        speed_ratio=round(ratio, 6),
                        rpm=round(input_rpm * ratio * direction, 6),
                    )
                )
                for nid in slot.meshes_with:
                    if nid not in seen and nid in self.state.placed:
                        seen.add(nid)
                        queue.append((self.model.slot(nid), -direction))  # type: ignore[arg-type]

        output_part = self.model.part(meta.output_part_id)
        connected = any(g.part_id == meta.output_part_id for g in gears)
        if not reasons and not connected:
            reasons.append("입력 기어에서 출력 기어까지 맞물림이 이어지지 않습니다.")
        operable = not reasons
        reduction = None
        if operable and input_part and output_part and input_part.teeth and output_part.teeth:
            reduction = round(output_part.teeth / input_part.teeth, 6)
        return MechanismState(
            operable=operable,
            reasons=reasons,
            input_rpm=input_rpm,
            reduction_ratio=reduction,
            gears=gears if operable else [],
        )
