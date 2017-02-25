﻿using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace AWSServerless.DynamoDB.Tables
{
    public class Change
    {
        public DateTime Tidemark { get; set; }
        public Guid RecordId { get; set; }
        public string Group { get; set; }
        public string Path { get; set; }
        public Guid DeviceId { get; set; }
        public DateTime Modified { get; set; }
        public string Value { get; set; }
    }
}