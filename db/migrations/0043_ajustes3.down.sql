-- 0043_ajustes3 (down). La reparación de títulos de tareas no se deshace (el título anterior era una clave interna).
update crm.stages s set required_fields = array_append(s.required_fields, 'decision_maker')
  from crm.pipelines p
 where p.id = s.pipeline_id and p.market_code = 'MX' and p.motor = 'd2d' and s.code = 'interes' and s.edited_at is null
   and not ('decision_maker' = any(s.required_fields));
