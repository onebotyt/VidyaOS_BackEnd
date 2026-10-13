/**
 * Master Domain Entities Registry
 * College Institutional Attendance & Management System
 */

const Admin = require('./Admin');
const Faculty = require('./Faculty');
const Student = require('./Student');
const Attendance = require('./Attendance');
const DigitalRegister = require('./DigitalRegister');
const AcademicStructure = require('./AcademicStructure');

module.exports = {
  Admin,
  Faculty,
  Student,
  Attendance,
  DigitalRegister,
  AcademicStructure
};
