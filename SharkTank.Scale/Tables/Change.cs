﻿using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace SharkSync.Scale.Tables
{
    public class Change
    {
        [JsonProperty("change_id")]
        public Guid Id { get; set; }
        [JsonProperty("rec_id")]
        public Guid RecordId { get; set; }
        [JsonProperty("path")]
        public string Path { get; set; }
        [JsonProperty("device_id")]
        public Guid DeviceId { get; set; }
        [JsonProperty("tidemark")]
        public string Tidemark { get; set; }
        [JsonProperty("modified")]
        public DateTime Modified { get; set; }
        [JsonProperty("value")]
        public string Value { get; set; }
    }
}
