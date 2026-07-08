import {
  doctorReportFormats,
  getDoctorReportSchema,
  type GetDoctorReportRequest,
} from '@nexus/core';

export class GetDoctorReportDto implements GetDoctorReportRequest {
  static get schema() {
    return getDoctorReportSchema;
  }

  format: (typeof doctorReportFormats)[number] = 'both';
}
