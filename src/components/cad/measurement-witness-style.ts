export interface MeasurementWitnessLineStyle {
  color: number;
  opacity: number;
  lineWidth: number;
}

export interface MeasurementWitnessMarkerStyle {
  color: number;
  opacity: number;
  scale: number;
}

export interface MeasurementWitnessStyleConfig {
  core: MeasurementWitnessLineStyle;
  halo: MeasurementWitnessLineStyle;
  marker: MeasurementWitnessMarkerStyle;
}

export function getMeasurementWitnessStyleConfig(): MeasurementWitnessStyleConfig {
  return {
    core: {
      color: 0xffde59,
      opacity: 0.96,
      lineWidth: 3.4,
    },
    halo: {
      color: 0xfff3a6,
      opacity: 0.22,
      lineWidth: 8.6,
    },
    marker: {
      color: 0xffde59,
      opacity: 0.92,
      scale: 1.6,
    },
  };
}
